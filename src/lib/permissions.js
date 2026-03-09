/**
 * RBAC permission helpers.
 * `actor` is the JWT payload: { sub, username, role, isSystemAdmin }
 */

export function isAdminOrDM(actor) {
  return actor?.role === 'admin' || actor?.role === 'data-manager';
}

export function isAdmin(actor) {
  return actor?.role === 'admin';
}

/** Can the actor see all datasets and jobs (not filtered to their own)? */
export function canViewAll(actor) {
  return isAdminOrDM(actor);
}

/** Can the actor create a dataset? admin or data-manager only */
export function canCreateDataset(actor) {
  return isAdminOrDM(actor);
}

/** Can the actor delete a dataset? */
export function canDeleteDataset(actor, dataset) {
  if (!actor) return false;
  if (isAdminOrDM(actor)) return true;
  return dataset.createdBy === Number(actor.sub);
}

/** Can the actor update a dataset's mutable settings? */
export function canUpdateDataset(actor, dataset) {
  if (!actor) return false;
  if (isAdminOrDM(actor)) return true;
  return dataset.createdBy === Number(actor.sub);
}

/** Can the actor assign/unassign/reassign/reset jobs within this dataset? */
export function canManageJobs(actor, dataset) {
  if (!actor) return false;
  if (isAdminOrDM(actor)) return true;
  return dataset.createdBy === Number(actor.sub);
}

/** Can the actor view and label a specific job? */
export function canAccessJob(actor, job) {
  if (!actor) return false;
  if (isAdminOrDM(actor)) return true;
  return job.assignedTo === Number(actor.sub);
}

/** Can the actor edit labels (save/delete) for a job? */
export function canEditJob(actor, job) {
  if (!actor) return false;
  if (isAdminOrDM(actor)) return true;
  // Regular user: must be the assignee, job must be in an editable state
  return (
    job.assignedTo === Number(actor.sub) &&
    (job.status === 'unlabelled' || job.status === 'labeling')
  );
}

/** Can the actor self-assign an unassigned job? */
export function canSelfAssign(actor) {
  return !!actor; // any authenticated user can self-assign
}

/** Can the actor self-unassign a job assigned to them? */
export function canSelfUnassign(actor, job) {
  if (!actor) return false;
  if (isAdminOrDM(actor)) return true;
  return job.assignedTo === Number(actor.sub);
}
