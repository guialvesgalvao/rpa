import { test as setup } from '@playwright/test';

import { ESTADO_SITE, USUARIOS } from '../apoio/ambiente.js';
import { entrarNoSite } from '../apoio/site.js';

// Um login por perfil e por execução; os specs reaproveitam os cookies (storageState).
for (const perfil of ['admin', 'finalista'] as const) {
  setup(`login do site: ${perfil}`, async ({ page }) => {
    await entrarNoSite(page, USUARIOS[perfil]);
    await page.context().storageState({ path: ESTADO_SITE[perfil] });
  });
}
