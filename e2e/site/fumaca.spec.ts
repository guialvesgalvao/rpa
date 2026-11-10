import { expect, test } from '@playwright/test';

import { ESTADO_SITE } from '../apoio/ambiente.js';

test.use({ storageState: ESTADO_SITE.admin });

test('@fumaca site abre Artes com a sessão salva', async ({ page }) => {
  await page.goto('/aba/artes');
  await expect(page.getByLabel('Buscar cliente')).toBeVisible();
});
