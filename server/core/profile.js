// What a player is allowed to see about their own account.
export function publicProfile(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.display_name,
    color: u.color,
    shards: u.shards,
    attempts: u.attempts,
    best: u.best_distance,
    lockedUntil: u.locked_until,
  };
}
