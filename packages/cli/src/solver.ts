import {
  createNovaSolveClient,
  createLocalSolveClient,
  createCachedSolveClient,
  type SolveClient,
} from '@astrolens/identify';

const numEnv = (k: string): number | undefined => {
  const v = process.env[k];
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Build the plate-solve client from config. `ASTROLENS_SOLVER=local` selects the
 * offline astrometry.net solver (solve-field) — for field/live use where nova's
 * remote queue is unreliable; otherwise nova. Either way it's wrapped in the
 * on-disk cache unless cache is disabled.
 *
 * Local solver env: ASTROMETRY_CFG (astrometry.cfg path), SOLVE_FIELD (binary
 * path), ASTROLENS_FOV_LOW / ASTROLENS_FOV_HIGH (field-width degree bounds — a
 * hint that greatly speeds the solve).
 */
export function createSolver(o: { apiKey?: string; cache?: boolean }): SolveClient {
  const useLocal = (process.env.ASTROLENS_SOLVER ?? '').toLowerCase() === 'local';
  let inner: SolveClient;
  if (useLocal) {
    inner = createLocalSolveClient({
      configPath: process.env.ASTROMETRY_CFG,
      solveField: process.env.SOLVE_FIELD,
      wcsinfo: process.env.WCSINFO,
      scaleLowDeg: numEnv('ASTROLENS_FOV_LOW'),
      scaleHighDeg: numEnv('ASTROLENS_FOV_HIGH'),
    });
  } else {
    if (!o.apiKey) {
      throw new Error(
        'Plate-solving needs a nova API key ($ASTROMETRY_API_KEY), or set ASTROLENS_SOLVER=local for offline solving.',
      );
    }
    inner = createNovaSolveClient({ apiKey: o.apiKey });
  }
  return o.cache === false ? inner : createCachedSolveClient(inner);
}
