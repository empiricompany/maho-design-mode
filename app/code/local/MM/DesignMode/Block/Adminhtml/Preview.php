<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Tony MageMEGA <https://magemega.com>
 * SPDX-License-Identifier: OSL-3.0
 */

/**
 * Publishes the preview configuration to the editor page.
 *
 * The editor is built by a template with its own configuration object, which a
 * module cannot extend without rewriting the CMS content tabs: the preview
 * settings travel on their own global instead, read by design-mode.js when the
 * shell opens.
 *
 * The block renders nothing when the page being edited is not a CMS page or a
 * CMS block, so the same layout handle can load it on every editor screen.
 */
class MM_DesignMode_Block_Adminhtml_Preview extends Mage_Core_Block_Abstract
{
    /**
     * @var array{entity: ?string, id: int, label: string}|null
     */
    private ?array $subject = null;

    /**
     * @var array<int, string>
     */
    private array $pagePaths = [];

    #[\Override]
    protected function _toHtml(): string
    {
        if ($this->getEntity() === null) {
            return '';
        }

        $json = json_encode(
            $this->getConfig(),
            JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );
        if (!is_string($json)) {
            return '';
        }

        return '<script>window.mahoDesignModePreview = ' . $json . ';</script>';
    }

    public function getEntity(): ?string
    {
        return $this->getSubject()['entity'];
    }

    public function getEntityId(): int
    {
        return $this->getSubject()['id'];
    }

    /**
     * @return array<string, mixed>
     */
    public function getConfig(): array
    {
        $entity = $this->getEntity();
        if ($entity === null) {
            return [];
        }

        $stores = $this->getStores();
        $storeId = $this->getEditorStoreId();
        $pagePath = $this->getPagePath($storeId);

        /** @var MM_DesignMode_Helper_Data $helper */
        $helper = Mage::helper('designmode');

        return [
            'entity' => $entity,
            'entityId' => $this->getEntityId(),
            'entityLabel' => $this->getSubject()['label'],
            'storeId' => $storeId,
            'stores' => $stores,
            'pagePath' => $pagePath,
            'defaultUrl' => $this->getStoreBaseUrl($stores, $storeId) . $pagePath,
            'previewParam' => MM_DesignMode_Helper_Data::PREVIEW_PARAM,
            'token' => $helper->createPreviewToken($entity, $this->getEntityId()),
            'renderUrl' => $this->adminUrl('designmode_preview', 'render'),
            'placesUrl' => $this->adminUrl('designmode_preview', 'places'),
        ];
    }

    /**
     * @return array{entity: ?string, id: int, label: string}
     */
    private function getSubject(): array
    {
        if ($this->subject !== null) {
            return $this->subject;
        }

        $page = Mage::registry('cms_page');
        if ($page instanceof Mage_Cms_Model_Page) {
            return $this->subject = [
                'entity' => 'page',
                'id' => (int) $page->getId(),
                'label' => (string) $page->getTitle(),
            ];
        }

        $block = Mage::registry('cms_block');
        if ($block instanceof Mage_Cms_Model_Block) {
            return $this->subject = [
                'entity' => 'block',
                'id' => (int) $block->getId(),
                'label' => (string) $block->getTitle(),
            ];
        }

        return $this->subject = ['entity' => null, 'id' => 0, 'label' => ''];
    }

    /**
     * Active stores the preview can open.
     *
     * A page or a block assigned to specific store views lists only those: the
     * others never render it, and previewing them would show a page without the
     * content being edited. An assignment to every store view (0) keeps them all.
     *
     * @return list<array{id: int, code: string, name: string, baseUrl: string}>
     */
    private function getStores(): array
    {
        $assigned = $this->getAssignedStoreIds();
        $restricted = $assigned !== [] && !in_array(0, $assigned, true);

        $stores = [];
        foreach (Mage::app()->getStores() as $store) {
            if (!$store instanceof Mage_Core_Model_Store || !$store->getIsActive()) {
                continue;
            }
            if ($restricted && !in_array((int) $store->getId(), $assigned, true)) {
                continue;
            }
            $stores[] = [
                'id' => (int) $store->getId(),
                'code' => (string) $store->getCode(),
                'name' => (string) $store->getName(),
                'baseUrl' => (string) $store->getBaseUrl(),
            ];
        }

        // A page kept only on inactive store views would leave the select empty
        return $stores === [] ? $this->getActiveStores() : $stores;
    }

    /**
     * @return list<array{id: int, code: string, name: string, baseUrl: string}>
     */
    private function getActiveStores(): array
    {
        $stores = [];
        foreach (Mage::app()->getStores() as $store) {
            if (!$store instanceof Mage_Core_Model_Store || !$store->getIsActive()) {
                continue;
            }
            $stores[] = [
                'id' => (int) $store->getId(),
                'code' => (string) $store->getCode(),
                'name' => (string) $store->getName(),
                'baseUrl' => (string) $store->getBaseUrl(),
            ];
        }

        return $stores;
    }

    /**
     * The store the preview opens on: the one requested, else the first store the
     * page or block is assigned to, else the default store view.
     *
     * A page can belong to a single store that carries its own theme and layout:
     * previewing it on the default store view would render its content inside a
     * different storefront.
     */
    private function getEditorStoreId(): int
    {
        $available = [];
        foreach ($this->getStores() as $store) {
            $available[] = $store['id'];
        }

        $requested = (int) $this->getRequest()->getParam('store', 0);
        if ($requested !== 0 && in_array($requested, $available, true)) {
            return $requested;
        }

        foreach ($this->getAssignedStoreIds() as $storeId) {
            if (in_array($storeId, $available, true)) {
                return $storeId;
            }
        }

        $default = Mage::app()->getDefaultStoreView();

        return $default instanceof Mage_Core_Model_Store ? (int) $default->getId() : 0;
    }

    /**
     * Store ids the edited page or block is assigned to. A single 0 means every
     * store view, which carries no theme of its own and is not a preview target.
     *
     * @return list<int>
     */
    private function getAssignedStoreIds(): array
    {
        $entity = $this->getEntity();
        if ($entity === null) {
            return [];
        }

        $resource = Mage::getResourceSingleton($entity === 'page' ? 'cms/page' : 'cms/block');
        if (!$resource instanceof Mage_Cms_Model_Resource_Page
            && !$resource instanceof Mage_Cms_Model_Resource_Block
        ) {
            return [];
        }

        $storeIds = $resource->lookupStoreIds($this->getEntityId());
        if (!is_array($storeIds)) {
            return [];
        }

        return array_values(array_map(intval(...), $storeIds));
    }

    /**
     * Path of the page inside the store base URL: empty for the home page and
     * for a block, which starts from the store home.
     */
    private function getPagePath(int $storeId): string
    {
        if ($this->getEntity() !== 'page' || $this->getEntityId() === 0) {
            return '';
        }
        if (isset($this->pagePaths[$storeId])) {
            return $this->pagePaths[$storeId];
        }

        /** @var Mage_Cms_Model_Page $page */
        $page = Mage::getModel('cms/page')->setStoreId($storeId)->load($this->getEntityId());
        $identifier = (string) $page->getIdentifier();
        $homePage = (string) Mage::getStoreConfig('web/default/cms_home_page', $storeId);
        $path = ($identifier === '' || $identifier === $homePage) ? '' : $identifier;

        return $this->pagePaths[$storeId] = $path;
    }

    /**
     * An admin URL carrying the secret key of this controller and action.
     *
     * The key cannot come from the route path alone: the URL model mints it
     * before the controller name is parsed out of the path, so on a
     * Symfony-routed admin action it would be signed for index/index and
     * refused by the dispatcher.
     */
    private function adminUrl(string $controller, string $action): string
    {
        /** @var Mage_Adminhtml_Model_Url $url */
        $url = Mage::getModel('adminhtml/url');

        return Mage_Adminhtml_Helper_Data::getUrl(
            'adminhtml/' . $controller . '/' . $action,
            ['key' => $url->getSecretKey($controller, $action), '_nosecret' => true],
        );
    }

    /**
     * @param list<array{id: int, code: string, name: string, baseUrl: string}> $stores
     */
    private function getStoreBaseUrl(array $stores, int $storeId): string
    {
        foreach ($stores as $store) {
            if ($store['id'] === $storeId) {
                return $store['baseUrl'];
            }
        }

        return '';
    }
}
