<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Tony MageMEGA <https://magemega.com>
 * SPDX-License-Identifier: OSL-3.0
 */

/**
 * Endpoints of the Design Mode preview.
 *
 * `render` resolves the directives of the content being edited for one store:
 * `{{widget}}`, `{{block}}`, `{{store url}}` and `{{icon}}` need PHP and the
 * store context, so the browser cannot do it alone. `places` answers the other
 * question a static block raises - where is it actually rendered? - instead of
 * asking the editor for a URL nobody knows: the URL of a block is not stored
 * anywhere, its placements are.
 */
class MM_DesignMode_Adminhtml_Designmode_PreviewController extends Mage_Adminhtml_Controller_Action
{
    private const MAX_PLACEMENTS = 25;

    /**
     * Both endpoints only read what a CMS editor already sees and only render
     * HTML the same editor typed, so a logged-in administrator is enough.
     */
    #[\Override]
    protected function _isAllowed(): bool
    {
        return Mage::getSingleton('admin/session')->getUser() !== null;
    }

    #[Maho\Config\Route('/admin/designmode_preview/render', methods: ['POST'])]
    public function renderAction(): void
    {
        $html = (string) $this->getRequest()->getParam('html', '');
        $storeId = (int) $this->getRequest()->getParam('store_id', 0);
        if ($html === '') {
            $this->respond(['html' => '']);
            return;
        }

        try {
            $rendered = $this->withStore($storeId, static function () use ($html): string {
                /** @var Mage_Cms_Helper_Data $helper */
                $helper = Mage::helper('cms');
                $processor = $helper->getPageTemplateProcessor();
                if (!$processor instanceof Mage_Cms_Model_Template_Filter) {
                    throw new RuntimeException('The CMS template processor is not available.');
                }

                return (string) $processor->filter(self::normalizeDirectives($html));
            });
        } catch (Throwable $exception) {
            Mage::logException($exception);
            $this->respond(['error' => $exception->getMessage()], 500);
            return;
        }

        $this->respond(['html' => $rendered]);
    }

    /**
     * The editor serializes an attribute value with its quotes escaped as HTML
     * entities, so a directive reaches the filter with those entities inside
     * the tag. The parser keeps them and the directive resolves to an URL that
     * carries the quotes, which 404s: decoding them inside the tag only fixes
     * it without touching the escaping of the content itself.
     */
    private static function normalizeDirectives(string $html): string
    {
        $normalized = preg_replace_callback(
            '/\{\{.*?\}\}/s',
            static fn(array $match): string => htmlspecialchars_decode($match[0], ENT_QUOTES),
            $html,
        );

        return is_string($normalized) ? $normalized : $html;
    }

    #[Maho\Config\Route('/admin/designmode_preview/places', methods: ['POST'])]
    public function placesAction(): void
    {
        $blockId = (int) $this->getRequest()->getParam('block_id', 0);
        $storeId = (int) $this->getRequest()->getParam('store_id', 0);
        if ($blockId <= 0) {
            $this->respond(['groups' => []]);
            return;
        }

        try {
            $groups = $this->withStore(
                $storeId,
                fn(): array => $this->findPlacements($blockId, $storeId),
            );
        } catch (Throwable $exception) {
            Mage::logException($exception);
            $this->respond(['error' => $exception->getMessage()], 500);
            return;
        }

        $this->respond(['groups' => $groups]);
    }

    /**
     * Runs the callback with the store emulated, then restores the store of the
     * admin request: model URLs and directives resolve against the current store.
     *
     * @template T
     * @param callable(): T $callback
     * @return T
     */
    private function withStore(int $storeId, callable $callback): mixed
    {
        $app = Mage::app();
        $current = $app->getStore();
        $previous = $current instanceof Mage_Core_Model_Store ? (int) $current->getId() : 0;
        $default = $app->getDefaultStoreView();
        $store = $app->getStore($storeId ?: (int) ($default instanceof Mage_Core_Model_Store ? $default->getId() : 0));
        if (!$store instanceof Mage_Core_Model_Store || !$store->getId()) {
            throw new RuntimeException('Unknown store.');
        }

        $app->setCurrentStore($store->getId());
        try {
            return $callback();
        } finally {
            $app->setCurrentStore($previous);
        }
    }

    /**
     * @return list<array{label: string, items: list<array{label: string, url: string}>}>
     */
    private function findPlacements(int $blockId, int $storeId): array
    {
        $found = [
            'Widget placements' => $this->widgetPlacements($blockId, $storeId),
            'Pages with the block in their content' => $this->pagePlacements($blockId, $storeId),
        ];

        $groups = [];
        $total = 0;
        foreach ($found as $label => $items) {
            $unique = [];
            foreach ($items as $item) {
                if (isset($unique[$item['url']]) || $total >= self::MAX_PLACEMENTS) {
                    continue;
                }
                $unique[$item['url']] = $item;
                $total++;
            }
            if ($unique !== []) {
                $groups[] = ['label' => $label, 'items' => array_values($unique)];
            }
        }

        return $groups;
    }

    /**
     * Placements coming from a widget rule: the rule knows the pages, the layout
     * handle, the block reference and the entity it is scoped to.
     *
     * @return list<array{label: string, url: string}>
     */
    private function widgetPlacements(int $blockId, int $storeId): array
    {
        $resource = Mage::getSingleton('core/resource');
        $adapter = $this->readConnection();
        $select = $adapter->select()
            ->from(
                ['wi' => $resource->getTableName('widget/widget_instance')],
                ['widget_parameters', 'store_ids'],
            )
            ->join(
                ['wip' => $resource->getTableName('widget/widget_instance_page')],
                'wip.instance_id = wi.instance_id',
                ['page_group', 'layout_handle', 'block_reference', 'entities'],
            )
            ->where('wi.instance_type = ?', 'cms/widget_block');

        $labels = ['products' => 'Product', 'categories' => 'Category'];
        $items = [];
        foreach ($adapter->fetchAll($select) as $row) {
            $parameters = $this->decodeArray($row['widget_parameters'] ?? null);
            if ((int) ($parameters['block_id'] ?? 0) !== $blockId) {
                continue;
            }
            if (!$this->isPlacedInStore((string) ($row['store_ids'] ?? '0'), $storeId)) {
                continue;
            }

            $suffix = implode(' · ', array_filter([
                (string) ($row['layout_handle'] ?? ''),
                (string) ($row['block_reference'] ?? ''),
            ]));
            $group = (string) ($row['page_group'] ?? '');
            $entities = array_slice($this->flatten($row['entities'] ?? null), 0, 3);

            if ($group === 'pages') {
                foreach ($entities as $pageId) {
                    $url = $this->cmsPageUrl($pageId, $storeId);
                    if ($url !== '') {
                        $items[] = ['label' => $this->withSuffix('CMS page ' . $pageId, $suffix), 'url' => $url];
                    }
                }
                continue;
            }

            if (isset($labels[$group])) {
                foreach ($entities as $entityId) {
                    $url = $group === 'products'
                        ? $this->productUrl($entityId, $storeId)
                        : $this->categoryUrl($entityId, $storeId);
                    if ($url !== '') {
                        $items[] = [
                            'label' => $this->withSuffix($labels[$group] . ' ' . $entityId, $suffix),
                            'url' => $url,
                        ];
                    }
                }
                continue;
            }

            // A rule scoped to every page: the home page is the sample, because
            // the block is identical wherever the rule puts it.
            $items[] = [
                'label' => $this->withSuffix('All pages', $suffix),
                'url' => $this->storeBaseUrl($storeId),
            ];
        }

        return $items;
    }

    /**
     * Pages that call the block from their own content.
     *
     * @return list<array{label: string, url: string}>
     */
    private function pagePlacements(int $blockId, int $storeId): array
    {
        $resource = Mage::getSingleton('core/resource');
        $adapter = $this->readConnection();
        $select = $adapter->select()
            ->from(
                ['p' => $resource->getTableName('cms/page')],
                ['page_id', 'title'],
            )
            ->where('p.content LIKE ?', '%block id="' . $blockId . '"%')
            ->orWhere('p.content LIKE ?', '%block_id="' . $blockId . '"%')
            ->orWhere('p.content LIKE ?', "%block id='" . $blockId . "'%")
            ->orWhere('p.content LIKE ?', "%block_id='" . $blockId . "'%")
            ->limit(self::MAX_PLACEMENTS);

        $items = [];
        foreach ($adapter->fetchAll($select) as $row) {
            $url = $this->cmsPageUrl((int) $row['page_id'], $storeId);
            if ($url !== '') {
                $items[] = ['label' => (string) $row['title'], 'url' => $url];
            }
        }

        return $items;
    }

    private function cmsPageUrl(int $pageId, int $storeId): string
    {
        if ($pageId <= 0) {
            return '';
        }

        /** @var Mage_Cms_Model_Page $page */
        $page = Mage::getModel('cms/page')->setStoreId($storeId)->load($pageId);
        $identifier = (string) $page->getIdentifier();
        if ($identifier === '') {
            return '';
        }

        $baseUrl = $this->storeBaseUrl($storeId);
        if ($identifier === (string) Mage::getStoreConfig('web/default/cms_home_page', $storeId)) {
            return $baseUrl;
        }

        return $baseUrl . $identifier;
    }

    private function storeBaseUrl(int $storeId): string
    {
        $store = Mage::app()->getStore($storeId);

        return $store instanceof Mage_Core_Model_Store ? (string) $store->getBaseUrl() : '';
    }

    private function readConnection(): Maho\Db\Adapter\AdapterInterface
    {
        $adapter = Mage::getSingleton('core/resource')->getConnection('core_read');
        if ($adapter === false) {
            throw new RuntimeException('The database connection is not available.');
        }

        return $adapter;
    }

    private function productUrl(int $productId, int $storeId): string
    {
        if ($productId <= 0) {
            return '';
        }

        /** @var Mage_Catalog_Model_Product $product */
        $product = Mage::getModel('catalog/product')->setStoreId($storeId)->load($productId);

        return $product->getId() ? (string) $product->getProductUrl() : '';
    }

    private function categoryUrl(int $categoryId, int $storeId): string
    {
        if ($categoryId <= 0) {
            return '';
        }

        /** @var Mage_Catalog_Model_Category $category */
        $category = Mage::getModel('catalog/category')->setStoreId($storeId)->load($categoryId);

        return $category->getId() ? (string) $category->getUrl() : '';
    }

    private function withSuffix(string $label, string $suffix): string
    {
        return $suffix === '' ? $label : $label . ' · ' . $suffix;
    }

    /**
     * Widget instance stores: "0" means every store.
     */
    private function isPlacedInStore(string $storeIds, int $storeId): bool
    {
        $ids = array_filter(array_map(intval(...), explode(',', $storeIds)));
        if ($ids === []) {
            return true;
        }

        return in_array(0, $ids, true) || in_array($storeId, $ids, true);
    }

    /**
     * A serialized array on a legacy row, JSON on a newer one; anything else is
     * ignored rather than trusted.
     *
     * @return array<mixed>
     */
    private function decodeArray(mixed $value): array
    {
        if (!is_string($value) || $value === '') {
            return [];
        }

        if (str_starts_with($value, '{') || str_starts_with($value, '[')) {
            $decoded = json_decode($value, true);

            return is_array($decoded) ? $decoded : [];
        }

        $decoded = @unserialize($value, ['allowed_classes' => false]);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Entity ids of a page placement, whatever the shape of the stored array.
     *
     * @return list<int>
     */
    private function flatten(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $ids = [];
        array_walk_recursive($value, static function (mixed $item) use (&$ids): void {
            if (is_scalar($item) && ctype_digit((string) $item)) {
                $ids[] = (int) $item;
            }
        });

        return $ids;
    }

    /**
     * @param array<string, mixed> $data
     */
    private function respond(array $data, int $status = 200): void
    {
        $response = $this->getResponse();
        $response->setHttpResponseCode($status);
        $response->setHeader('Content-Type', 'application/json', true);
        // An error message built from a path or a file name is not always valid
        // UTF-8; substituting the bad bytes keeps the answer JSON instead of
        // turning the failure into a second, unrelated exception.
        $body = json_encode($data, JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
        $response->setBody($body);
    }
}
