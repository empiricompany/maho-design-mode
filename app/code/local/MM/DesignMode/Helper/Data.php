<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Tony MageMEGA <https://magemega.com>
 * SPDX-License-Identifier: OSL-3.0
 */

/**
 * Shared helpers of the Design Mode module.
 *
 * The preview replaces a block on a page of the storefront, so that page has
 * to know which block is being edited. The admin mints a signed token and the
 * preview URL carries it: the marker can only be produced by a token signed
 * with the installation key, and it expires, so it is not a way to read draft
 * content from the outside.
 */
class MM_DesignMode_Helper_Data extends Mage_Core_Helper_Abstract
{
    /**
     * Query parameter carrying the signed token on a storefront URL.
     */
    public const PREVIEW_PARAM = 'mm_preview';

    /**
     * Prefix of the cache entry holding the draft being previewed.
     */
    public const DRAFT_PREFIX = 'mm_design_draft_';

    /**
     * A tab can stay open for a long time; an expired token only degrades the
     * preview to the standalone content, so the lifetime can be generous.
     */
    private const TOKEN_LIFETIME = 14400;

    private const SIGNATURE_LENGTH = 32;

    /**
     * Long enough for a page load, short enough that a closed tab leaves no
     * draft behind.
     */
    private const DRAFT_LIFETIME = 300;

    /**
     * Parsed once per request: the observer asks for the token on every block of
     * the page, and the signature check is not free.
     *
     * @var array{entity: string, id: int}|null
     */
    private ?array $token = null;

    private bool $tokenParsed = false;

    public function getPreviewSecret(): string
    {
        $config = Mage::getConfig();

        return $config instanceof Mage_Core_Model_Config ? (string) $config->getNode('global/crypt/key') : '';
    }

    public function createPreviewToken(string $entity, int $entityId): string
    {
        $payload = $entity . ':' . $entityId . ':' . (time() + self::TOKEN_LIFETIME);

        return $payload . ':' . $this->signature($payload);
    }

    /**
     * @return array{entity: string, id: int}|null
     */
    public function readPreviewToken(mixed $token): ?array
    {
        if (!$this->tokenParsed) {
            $this->tokenParsed = true;
            $this->token = $this->parsePreviewToken($token);
        }

        return $this->token;
    }

    /**
     * @return array{entity: string, id: int}|null
     */
    private function parsePreviewToken(mixed $token): ?array
    {
        if (!is_string($token) || $token === '') {
            return null;
        }

        $parts = explode(':', $token);
        if (count($parts) !== 4) {
            return null;
        }

        [$entity, $id, $expires, $signature] = $parts;
        if (!ctype_digit($id) || !ctype_digit($expires)) {
            return null;
        }
        if (!hash_equals($this->signature($entity . ':' . $id . ':' . $expires), $signature)) {
            return null;
        }
        if ((int) $expires < time()) {
            return null;
        }

        return ['entity' => $entity, 'id' => (int) $id];
    }

    /**
     * The draft travels through the cache, not through the request: the admin
     * posts it, then the previewed page reads it while it renders. A POST to the
     * page itself is not an option, because the store home answers GET only and
     * redirects a POST before the request reaches the block.
     */
    public function saveDraft(string $token, string $html): void
    {
        Mage::app()->getCache()->save($html, $this->draftKey($token), [], self::DRAFT_LIFETIME);
    }

    public function loadDraft(string $token): ?string
    {
        $draft = Mage::app()->getCache()->load($this->draftKey($token));

        return is_string($draft) ? $draft : null;
    }

    public function clearDraft(string $token): void
    {
        Mage::app()->getCache()->remove($this->draftKey($token));
    }

    private function draftKey(string $token): string
    {
        return self::DRAFT_PREFIX . md5($token);
    }

    private function signature(string $payload): string
    {
        return substr(hash_hmac('sha256', $payload, $this->getPreviewSecret()), 0, self::SIGNATURE_LENGTH);
    }
}
