import { allFeaturesOn, isFeatureKey, type FeatureKey, type FeatureSet } from "../../shared/features";
import { AppError, type Ctx } from "./http";

/** The features of one business (one small query; a feature without a row is on). */
export async function loadFeatures(db: D1Database, businessId: string): Promise<FeatureSet> {
  const set = allFeaturesOn();
  const { results } = await db.prepare("SELECT feature, enabled FROM business_features WHERE business_id = ?").bind(businessId).all<{ feature: string; enabled: number }>();
  for (const r of results) if (isFeatureKey(r.feature)) set[r.feature] = r.enabled === 1;
  return set;
}

/** Ids of businesses among `businessIds` that have `feature` switched off. */
export async function businessesWithFeatureOff(db: D1Database, feature: FeatureKey, businessIds: string[]): Promise<Set<string>> {
  if (!businessIds.length) return new Set();
  const { results } = await db
    .prepare(`SELECT business_id FROM business_features WHERE feature = ? AND enabled = 0 AND business_id IN (${businessIds.map(() => "?").join(",")})`)
    .bind(feature, ...businessIds)
    .all<{ business_id: string }>();
  return new Set(results.map((r) => r.business_id));
}

/** Refuses the request if the caller's business has this feature switched off. Admins (no business) are never blocked. */
export function requireFeature(c: Ctx, feature: FeatureKey): void {
  if (!featureOn(c, feature)) {
    throw new AppError(403, "FEATURE_DISABLED", "This feature isn't enabled for your business. Contact DealerLink support to turn it on.");
  }
}

export const featureOn = (c: Ctx, feature: FeatureKey): boolean => {
  const features = c.get("auth")?.features;
  return !features || features[feature];
};
