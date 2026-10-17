<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Tony MageMEGA <https://magemega.com>
 * SPDX-License-Identifier: OSL-3.0
 */

/**
 * Marks the block a Design Mode preview is going to replace.
 *
 * The preview loads the real page of the storefront, header and footer
 * included, and then swaps the content in place. To do that without guessing a
 * selector, the page itself wraps the edited block in an element carrying
 * `data-mm-design-target`: the admin script only has to fill that element.
 *
 * The event fires on every block, cache hit or not: `toHtml()` dispatches it
 * after loading the cache, so a cached block is still marked.
 */
class MM_DesignMode_Model_Observer
{
    private const MARKER_ATTRIBUTE = 'data-mm-design-target';

    #[Maho\Config\Observer('core_block_abstract_to_html_after', area: 'frontend')]
    public function markPreviewTarget(Maho\Event\Observer $observer): void
    {
        $event = $observer->getEvent();
        $token = $this->helper()->readPreviewToken(
            Mage::app()->getRequest()->getParam(MM_DesignMode_Helper_Data::PREVIEW_PARAM),
        );
        if ($token === null) {
            return;
        }

        $block = $event->getBlock();
        $transport = $event->getData('transport');
        if (!$block instanceof Mage_Core_Block_Abstract || !$transport instanceof Maho\DataObject) {
            return;
        }
        if (!$this->isTarget($block, $token['entity'], $token['id'])) {
            return;
        }

        $html = (string) $transport->getHtml();
        if (str_contains($html, self::MARKER_ATTRIBUTE)) {
            return;
        }

        // The preview posts the content being edited to the storefront URL: it is
        // filtered like saved content, so the page is served complete and the
        // theme initializes it as on the storefront — no client-side injection.
        $draft = Mage::app()->getRequest()->getPost('mm_html');
        if (is_string($draft) && $draft !== '') {
            /** @var Mage_Cms_Helper_Data $cmsHelper */
            $cmsHelper = Mage::helper('cms');
            $processor = $cmsHelper->getPageTemplateProcessor();
            if ($processor instanceof Mage_Cms_Model_Template_Filter) {
                $html = (string) $processor->filter($draft);
            }
        }

        $transport->setData(
            'html',
            '<div ' . self::MARKER_ATTRIBUTE . '="' . $token['entity'] . '">' . $html . '</div>',
        );
        // The page is served for one request only: a cached copy would keep the
        // marker after the editor is closed.
        Mage::app()->getResponse()->setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    private function isTarget(Mage_Core_Block_Abstract $block, string $entity, int $entityId): bool
    {
        if ($entity === 'block') {
            return $block instanceof Mage_Cms_Block_Block && (int) $block->getBlockId() === $entityId;
        }
        if ($entity === 'page') {
            return $block instanceof Mage_Cms_Block_Page && (int) $block->getPage()->getId() === $entityId;
        }

        return false;
    }

    private function helper(): MM_DesignMode_Helper_Data
    {
        /** @var MM_DesignMode_Helper_Data $helper */
        $helper = Mage::helper('designmode');

        return $helper;
    }
}
