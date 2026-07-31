/**
 * DeviceHub's HID protocol reserves five stable contact identities (0..4),
 * while React Native may assign arbitrary identifiers to native touches.
 * Keep that translation local to the gesture surface and release slots when
 * a contact ends so a later gesture can reuse them.
 */
export class TouchIdentityAllocator {
  private readonly identities = new Map<string, number>();

  identityFor(identifier: string | number) {
    const key = String(identifier);
    const existing = this.identities.get(key);
    if (existing !== undefined) return existing;

    const used = new Set(this.identities.values());
    for (let identity = 0; identity < 5; identity += 1) {
      if (!used.has(identity)) {
        this.identities.set(key, identity);
        return identity;
      }
    }
    return null;
  }

  release(identifier: string | number) {
    this.identities.delete(String(identifier));
  }

  clear() {
    this.identities.clear();
  }
}
