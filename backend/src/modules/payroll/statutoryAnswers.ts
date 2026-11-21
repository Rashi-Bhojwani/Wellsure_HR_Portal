import { STATUTORY_ANSWER_KEYS, STATUTORY_ANSWER_LABEL, type StatutoryAnswer, type StatutoryAnswerKey } from "@shared/constants/statutoryAnswers";
import { prisma } from "../../lib/prisma";
import { behaviourValue } from "../behaviours/service";
import { loadItems, summarise } from "./items";

// FIX-M5 (independent audit 2026-11-20): the directors' answers for professional tax, LWF and minimum wages, and what is still open for a real run.
export async function statutoryAnswers(): Promise<Record<StatutoryAnswerKey, StatutoryAnswer | null>> {
  const out = {} as Record<StatutoryAnswerKey, StatutoryAnswer | null>;
  for (const k of STATUTORY_ANSWER_KEYS) out[k] = ((await behaviourValue(k)).value as StatutoryAnswer | null) ?? null;
  return out;
}

/** Whether the values an "Applies" answer needs are entered: the PT / LWF table, or minimum wage rates and the compared heads. */
export async function statutoryValuesEntered(): Promise<Record<StatutoryAnswerKey, boolean>> {
  const rules = await loadItems("RULE", ["PT_SLABS", "LWF_TABLE"]);
  const [rates, basis] = await Promise.all([prisma.minimumWageRate.count(), prisma.minimumWageBasis.count()]);
  return {
    "statutory.professionalTax": Boolean(summarise(rules, "PT_SLABS").current),
    "statutory.labourWelfareFund": Boolean(summarise(rules, "LWF_TABLE").current),
    "statutory.minimumWages": rates > 0 && basis > 0,
  };
}

/** What stops a real monthly run: an answer that is Not set, or "Applies" with no values entered. Empty when the run may go ahead. */
export async function statutoryRunProblems(): Promise<string[]> {
  const [answers, entered] = await Promise.all([statutoryAnswers(), statutoryValuesEntered()]);
  const problems: string[] = [];
  for (const k of STATUTORY_ANSWER_KEYS) {
    if (answers[k] === null) problems.push(`${STATUTORY_ANSWER_LABEL[k]}: Not set (choose "Does not apply to us" or "Applies")`);
    else if (answers[k] === "APPLIES" && !entered[k]) problems.push(`${STATUTORY_ANSWER_LABEL[k]}: "Applies", but its values are not entered`);
  }
  return problems;
}
