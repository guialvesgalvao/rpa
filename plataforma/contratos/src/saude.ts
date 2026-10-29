import { z } from 'zod';

export const EsquemaSaude = z.object({ status: z.literal('ok') });

export type Saude = z.infer<typeof EsquemaSaude>;
