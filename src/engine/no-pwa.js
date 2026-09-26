/**
 * Stands in for the update watcher in the copy that runs as one file from a
 * folder: there is no worker, server or new version, so nothing to watch for.
 */
export const registerSW = () => () => {};
