import type { TrainingPackage } from "@/db/schema";
import { parseAndValidateTrainingMaterialPayload } from "@/lib/materials/schema";
import type { TrainingMaterialPayload } from "@/lib/materials/types";

export type TrainingPackageStatus = "pending" | "running" | "succeeded" | "failed";
export type MaterialJobStatus = "pending" | "running" | "succeeded" | "failed";
export const MATERIAL_JOB_TYPE = "full_training_pack";

export function serializeTrainingPayload(payload: TrainingMaterialPayload): string {
  return JSON.stringify(payload);
}

export function deserializeTrainingPayload(payloadJson: string | null): TrainingMaterialPayload | null {
  if (!payloadJson) return null;
  return parseAndValidateTrainingMaterialPayload(JSON.parse(payloadJson));
}

export function toMaterialApiPackage(trainingPackage: TrainingPackage | null) {
  if (!trainingPackage) return null;
  const { payloadJson, ...rest } = trainingPackage;

  return {
    ...rest,
    payload: deserializeTrainingPayload(payloadJson),
  };
}
