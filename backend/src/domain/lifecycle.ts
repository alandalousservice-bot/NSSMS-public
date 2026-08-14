export type SeasonStatus = 'DRAFT'|'UNDER_REVIEW'|'APPROVED'|'ACTIVE'|'CLOSED'|'ARCHIVED';
export type CompetitionStatus = 'DRAFT'|'REVIEW'|'APPROVED'|'REGISTRATION'|'ACTIVE'|'RESULTS'|'CLOSED'|'ARCHIVED';
export type LicenseStatus = 'APPLICATION'|'VALIDATION'|'APPROVAL'|'ISSUED'|'ACTIVE'|'EXPIRED'|'SUSPENDED'|'ARCHIVED';

const transitions: Record<string, Record<string, readonly string[]>> = {
  season: {DRAFT:['UNDER_REVIEW'], UNDER_REVIEW:['DRAFT','APPROVED'], APPROVED:['ACTIVE'], ACTIVE:['CLOSED'], CLOSED:['ARCHIVED']},
  competition: {DRAFT:['REVIEW'], REVIEW:['DRAFT','APPROVED'], APPROVED:['REGISTRATION'], REGISTRATION:['ACTIVE'], ACTIVE:['RESULTS'], RESULTS:['CLOSED'], CLOSED:['ARCHIVED']},
  license: {APPLICATION:['VALIDATION'], VALIDATION:['APPLICATION','APPROVAL'], APPROVAL:['ISSUED'], ISSUED:['ACTIVE'], ACTIVE:['EXPIRED','SUSPENDED'], EXPIRED:['ARCHIVED'], SUSPENDED:['ACTIVE','ARCHIVED']}
};

export function assertTransition(entity: 'season'|'competition'|'license', from: string, to: string): void {
  if (!transitions[entity]?.[from]?.includes(to)) throw new Error(`Invalid ${entity} transition: ${from} -> ${to}`);
}
