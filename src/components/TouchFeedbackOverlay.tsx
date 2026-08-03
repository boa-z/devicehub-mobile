import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../i18n";
import { displayedVideoSize, projectTouchPoint, type TouchSurfaceSize, type VideoFrameSize } from "../input/touchCoordinates";
import type { MultiTouchContact, Orientation } from "../protocol/types";

type TouchFeedbackAction = "down" | "move" | "up";

type TouchFeedbackEvent = MultiTouchContact & {
  action: TouchFeedbackAction;
  at: number;
};

type Props = {
  visible: boolean;
  surface: TouchSurfaceSize;
  video: VideoFrameSize | null;
  contacts: readonly MultiTouchContact[];
  orientation: Orientation;
};

function contactKey(contact: Pick<MultiTouchContact, "identity">) {
  return String(contact.identity);
}

function sameContact(left: MultiTouchContact, right: MultiTouchContact) {
  return left.touching === right.touching && left.x === right.x && left.y === right.y;
}

function diffContacts(
  previous: ReadonlyMap<string, MultiTouchContact>,
  current: readonly MultiTouchContact[],
  at: number,
): TouchFeedbackEvent[] {
  const events: TouchFeedbackEvent[] = [];
  const currentKeys = new Set<string>();
  for (const contact of current) {
    const key = contactKey(contact);
    currentKeys.add(key);
    const before = previous.get(key);
    if (!before) {
      events.push({ ...contact, action: contact.touching ? "down" : "up", at });
    } else if (!sameContact(before, contact)) {
      events.push({ ...contact, action: contact.touching ? "move" : "up", at });
    }
  }
  for (const [key, contact] of previous) {
    if (!currentKeys.has(key) && contact.touching) {
      events.push({ ...contact, touching: false, action: "up", at });
    }
  }
  return events;
}

function normalizedCoordinate(value: number, size: number | undefined) {
  if (!size || size <= 0) return `${Math.round(value * 100)}%`;
  return String(Math.round(value * Math.max(0, size - 1)));
}

function orientedCoordinates(x: number, y: number, orientation: Orientation, frame: VideoFrameSize | null) {
  const displayX = Math.max(0, Math.min(1, x));
  const displayY = Math.max(0, Math.min(1, y));
  const [nativeX, nativeY] = orientation === "landscape_right"
    ? [displayY, 1 - displayX]
    : orientation === "portrait_upside_down"
      ? [1 - displayX, 1 - displayY]
      : orientation === "landscape_left"
        ? [1 - displayY, displayX]
        : [displayX, displayY];
  const displayFrame = displayedVideoSize(frame, orientation);
  return {
    display: `${normalizedCoordinate(displayX, displayFrame?.width)}, ${normalizedCoordinate(displayY, displayFrame?.height)}`,
    native: `${normalizedCoordinate(nativeX, frame?.width)}, ${normalizedCoordinate(nativeY, frame?.height)}`,
  };
}

export function TouchFeedbackOverlay({ visible, surface, video, contacts: inputContacts, orientation }: Props) {
  const { t } = useI18n();
  const contacts = useMemo(
    () => inputContacts.filter((contact) => contact.touching),
    [inputContacts],
  );
  const [renderVersion, setRenderVersion] = useState(0);
  const previousRef = useRef(new Map<string, MultiTouchContact>());
  const trailRef = useRef<TouchFeedbackEvent[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const scheduleRender = () => {
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;
        setRenderVersion((version) => version + 1);
      });
    };
    if (!visible) {
      previousRef.current.clear();
      trailRef.current = [];
      return;
    }
    const events = diffContacts(previousRef.current, contacts, Date.now());
    previousRef.current.clear();
    for (const contact of contacts) previousRef.current.set(contactKey(contact), contact);
    if (events.length) {
      trailRef.current = [...trailRef.current, ...events].slice(-96);
      scheduleRender();
    }
  }, [contacts, visible]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  if (!visible) return null;
  void renderVersion;
  const trail = trailRef.current;
  const latest = trail[trail.length - 1];
  const actionLabel = latest
    ? latest.action === "down" ? t("touchFeedbackDown") : latest.action === "move" ? t("touchFeedbackMove") : t("touchFeedbackUp")
    : null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.summary}>
        <Text style={styles.summaryTitle}>{t("touchFeedbackDebug")}</Text>
        <Text style={styles.summaryText}>{t("touchFeedbackContacts", { count: contacts.length })}</Text>
        {latest && actionLabel ? <Text style={styles.summaryText}>{actionLabel} · D{latest.identity}</Text> : null}
      </View>
      {trail.map((event, index) => {
        const point = projectTouchPoint(event.x, event.y, surface, video, orientation);
        return (
          <View
            key={`${event.identity}:${event.at}:${index}`}
            style={[
              styles.trail,
              { left: point.x, top: point.y, opacity: Math.max(0.08, ((index + 1) / trail.length) * 0.42) },
              event.action === "up" && styles.trailReleased,
            ]}
          />
        );
      })}
      {contacts.map((contact) => {
        const point = projectTouchPoint(contact.x, contact.y, surface, video, orientation);
        const labelOnLeft = point.x > surface.width * 0.68;
        const labelAbove = point.y > surface.height * 0.72;
        const coordinates = orientedCoordinates(contact.x, contact.y, orientation, video);
        return (
          <View
            key={contactKey(contact)}
            style={[styles.contact, { left: point.x, top: point.y }]}
          >
            <View style={styles.crossHorizontal} />
            <View style={styles.crossVertical} />
            <View style={[styles.label, labelOnLeft && styles.labelLeft, labelAbove && styles.labelAbove]}>
              <Text style={styles.labelTitle}>D{contact.identity}</Text>
              <Text style={styles.labelText}>{t("touchFeedbackDirect")}</Text>
              <Text style={styles.labelText}>{t("touchFeedbackCoordinate", { display: coordinates.display, native: coordinates.native })}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { backgroundColor: "rgba(8, 11, 12, 0.86)", borderColor: "rgba(237, 242, 240, 0.2)", borderRadius: 5, borderWidth: 1, maxWidth: 220, paddingHorizontal: 8, paddingVertical: 6, position: "absolute", right: 8, top: 8 },
  summaryTitle: { color: "#f0c75e", fontSize: 11, fontWeight: "700" },
  summaryText: { color: "#b7c0be", fontSize: 10, lineHeight: 14 },
  contact: { height: 22, marginLeft: -11, marginTop: -11, position: "absolute", width: 22 },
  crossHorizontal: { backgroundColor: "#f0c75e", height: 1, left: -4, opacity: 0.9, position: "absolute", top: 10, width: 30 },
  crossVertical: { backgroundColor: "#f0c75e", height: 30, left: 10, opacity: 0.9, position: "absolute", top: -4, width: 1 },
  label: { backgroundColor: "rgba(8, 11, 12, 0.9)", borderColor: "rgba(240, 199, 94, 0.42)", borderRadius: 3, borderWidth: 1, left: 20, maxWidth: 210, minWidth: 118, paddingHorizontal: 6, paddingVertical: 4, position: "absolute", top: 20 },
  labelLeft: { left: undefined, right: 20 },
  labelAbove: { bottom: 20, top: undefined },
  labelTitle: { color: "#f0c75e", fontSize: 11, fontWeight: "700", lineHeight: 13 },
  labelText: { color: "#b7c0be", fontSize: 9, lineHeight: 12 },
  trail: { backgroundColor: "rgba(240, 199, 94, 0.28)", borderColor: "#f0c75e", borderRadius: 4, borderWidth: 1, height: 8, marginLeft: -4, marginTop: -4, position: "absolute", width: 8 },
  trailReleased: { borderStyle: "dashed" },
});
