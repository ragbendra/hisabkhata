import { useMe } from "./queries";

/** True when the shop keeps crate counts (Settings > "Track crates"). Crate columns and fields show only then. */
export function useTrackCrates(): boolean {
  const me = useMe();
  return !!me.data?.shop?.track_crates;
}
