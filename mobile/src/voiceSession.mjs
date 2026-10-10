// Invalidates pending permission/model lookups when a voice panel closes or reopens.
export function createVoiceSession() {
  let generation = 0;
  let opened = false;
  let pending = false;
  return {
    open() { generation += 1; opened = true; pending = false; },
    close() { generation += 1; opened = false; pending = false; },
    begin() {
      if (!opened || pending) return null;
      pending = true;
      return generation;
    },
    isCurrent(requestId) { return opened && generation === requestId; },
    finish(requestId) {
      if (!opened || generation !== requestId) return false;
      pending = false;
      return true;
    },
  };
}
