// Ignore stale storage reads while a user-selected setting is being persisted.
function createAutoDownloadSyncGuard() {
  let revision = 0;
  let pending = null;
  let issuedHydration = 0;
  let acceptedHydration = 0;
  return {
    localChange(value) { revision++; pending = Boolean(value); },
    // Called only after an accepted storage read changes the live value.
    // This invalidates downloads that began under the earlier state.
    externalChange() { revision++; },
    beginRead() { return revision; },
    beginHydrationRead() { return {revision, sequence:++issuedHydration}; },
    isCurrentEnabled(readRevision, enabled) {
      return readRevision === revision && enabled === true;
    },
    acceptHydrationRead(ticket, value) {
      if (!ticket || ticket.revision !== revision || !Number.isSafeInteger(ticket.sequence) || ticket.sequence <= acceptedHydration || ticket.sequence > issuedHydration) return false;
      if (pending !== null && pending !== Boolean(value)) return false;
      pending = null;
      acceptedHydration = ticket.sequence;
      return true;
    },
  };
}

module.exports = { createAutoDownloadSyncGuard };
