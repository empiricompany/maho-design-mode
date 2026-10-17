<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Tony MageMEGA <https://magemega.com>
 * SPDX-License-Identifier: OSL-3.0
 */

/**
 * Endpoint of the Design Mode preview.
 *
 * The content itself is rendered by the storefront for the page being previewed,
 * so the only thing the admin has to hand over is the draft being edited: it is
 * left in the cache under the preview token and the storefront reads it while it
 * renders.
 */
class MM_DesignMode_Adminhtml_Designmode_PreviewController extends Mage_Adminhtml_Controller_Action
{
    /**
     * The endpoint only stores what a CMS editor already typed, so the CMS
     * resources are the ones that decide.
     */
    #[\Override]
    protected function _isAllowed(): bool
    {
        $session = Mage::getSingleton('admin/session');

        return $session->isAllowed('cms/page') || $session->isAllowed('cms/block');
    }

    /**
     * Stores the content being edited so the page in the preview can render it.
     * The storefront cannot receive it: the store home answers GET only and
     * redirects a POST before the request reaches the block, so the draft is
     * left in the cache under the token and read while the page renders.
     */
    #[Maho\Config\Route('/admin/designmode_preview/draft', methods: ['POST'])]
    public function draftAction(): void
    {
        $token = $this->getRequest()->getParam('token');
        $html = $this->getRequest()->getParam('html');
        if (!is_string($token) || !is_string($html)) {
            $this->respond(['error' => 'Missing token or content'], 400);
            return;
        }

        /** @var MM_DesignMode_Helper_Data $helper */
        $helper = Mage::helper('designmode');
        if ($helper->readPreviewToken($token) === null) {
            $this->respond(['error' => 'Unknown token'], 400);
            return;
        }

        $helper->saveDraft($token, $html);
        $this->respond(['ok' => true]);
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
