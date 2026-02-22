/*
This file is part of the Notesnook project (https://notesnook.com/)

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import { useState, useEffect } from "react";
import { Box, Button, Flex, Input, Text } from "@theme-ui/components";
import { AppEventManager, AppEvents } from "../common/app-events";
import {
  useStore as useCalendarStore,
  CalendarEvent,
  CalendarEventType,
  CalendarViewMode
} from "../stores/calendar-store";

const TYPE_ICONS: Record<CalendarEventType, string> = {
  meeting: "📅",
  deadline: "⏰",
  reminder: "🔔",
  block: "🚫"
};

const EVENT_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316"
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7am to 8pm

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function toDateTimeLocal(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocal(val: string): number {
  return new Date(val).getTime();
}

// ── New Event Form ──

function NewEventForm({ onClose }: { onClose: () => void }) {
  const addEvent = useCalendarStore((s) => s.addEvent);
  const selectedDate = useCalendarStore((s) => s.selectedDate);

  const defaultStart = new Date(selectedDate);
  defaultStart.setHours(9, 0, 0, 0);
  const defaultEnd = new Date(selectedDate);
  defaultEnd.setHours(10, 0, 0, 0);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<CalendarEventType>("meeting");
  const [startTime, setStartTime] = useState(toDateTimeLocal(defaultStart.getTime()));
  const [endTime, setEndTime] = useState(toDateTimeLocal(defaultEnd.getTime()));
  const [allDay, setAllDay] = useState(false);
  const [color, setColor] = useState("#3b82f6");
  const [attendeesStr, setAttendeesStr] = useState("");

  const handleSubmit = () => {
    if (!title.trim()) return;
    const start = fromDateTimeLocal(startTime);
    const end = allDay ? start : fromDateTimeLocal(endTime);
    addEvent({
      title: title.trim(),
      description: description.trim(),
      type,
      startTime: start,
      endTime: end,
      allDay,
      color,
      createdBy: "human",
      agentId: null,
      linkedTaskId: null,
      attendees: attendeesStr
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
    });
    onClose();
  };

  const types: CalendarEventType[] = ["meeting", "deadline", "reminder", "block"];

  return (
    <Flex
      sx={{
        flexDirection: "column",
        bg: "background-secondary",
        borderRadius: 8,
        border: "1px solid var(--border)",
        p: 3,
        gap: 2,
        width: 320,
        flexShrink: 0,
        overflow: "auto"
      }}
    >
      <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}>
        New Event
      </Text>

      <Input
        placeholder="Event title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        sx={{ fontSize: 13 }}
        autoFocus
      />

      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{
          fontSize: 12,
          padding: "8px",
          borderRadius: "4px",
          border: "1px solid var(--border)",
          background: "var(--background)",
          color: "var(--paragraph)",
          resize: "vertical",
          minHeight: "50px",
          fontFamily: "inherit"
        }}
      />

      {/* Type selector */}
      <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
        {types.map((t) => (
          <Button
            key={t}
            variant={type === t ? "accent" : "secondary"}
            sx={{ fontSize: 11, px: 2, py: 1, textTransform: "capitalize" }}
            onClick={() => setType(t)}
          >
            {TYPE_ICONS[t]} {t}
          </Button>
        ))}
      </Flex>

      {/* All-day toggle */}
      <Flex
        sx={{ alignItems: "center", gap: 2, cursor: "pointer" }}
        onClick={() => setAllDay(!allDay)}
      >
        <Box
          sx={{
            width: 16,
            height: 16,
            borderRadius: 3,
            border: "2px solid var(--border)",
            bg: allDay ? "accent" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          {allDay && (
            <Text sx={{ fontSize: 10, color: "white", lineHeight: 1 }}>
              ✓
            </Text>
          )}
        </Box>
        <Text sx={{ fontSize: 12, color: "paragraph" }}>All day</Text>
      </Flex>

      {/* Date/Time inputs */}
      <Flex sx={{ flexDirection: "column", gap: 1 }}>
        <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>Start</Text>
        <input
          type={allDay ? "date" : "datetime-local"}
          value={allDay ? startTime.split("T")[0] : startTime}
          onChange={(e) =>
            setStartTime(
              allDay ? e.target.value + "T00:00" : e.target.value
            )
          }
          style={{
            fontSize: 12,
            padding: "6px 8px",
            borderRadius: "4px",
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--paragraph)",
            fontFamily: "inherit"
          }}
        />
      </Flex>

      {!allDay && (
        <Flex sx={{ flexDirection: "column", gap: 1 }}>
          <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>End</Text>
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={{
              fontSize: 12,
              padding: "6px 8px",
              borderRadius: "4px",
              border: "1px solid var(--border)",
              background: "var(--background)",
              color: "var(--paragraph)",
              fontFamily: "inherit"
            }}
          />
        </Flex>
      )}

      {/* Color picker */}
      <Flex sx={{ flexDirection: "column", gap: 1 }}>
        <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>Color</Text>
        <Flex sx={{ gap: 1 }}>
          {EVENT_COLORS.map((c) => (
            <Box
              key={c}
              onClick={() => setColor(c)}
              sx={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                bg: c,
                cursor: "pointer",
                border:
                  color === c ? "2px solid var(--heading)" : "2px solid transparent",
                "&:hover": { opacity: 0.8 }
              }}
            />
          ))}
        </Flex>
      </Flex>

      {/* Attendees */}
      <Input
        placeholder="Attendees (comma-separated)"
        value={attendeesStr}
        onChange={(e) => setAttendeesStr(e.target.value)}
        sx={{ fontSize: 12 }}
      />

      {/* Actions */}
      <Flex sx={{ gap: 2, mt: 1 }}>
        <Button
          variant="accent"
          sx={{ flex: 1, fontSize: 12 }}
          onClick={handleSubmit}
          disabled={!title.trim()}
        >
          Create Event
        </Button>
        <Button
          variant="secondary"
          sx={{ fontSize: 12 }}
          onClick={onClose}
        >
          Cancel
        </Button>
      </Flex>
    </Flex>
  );
}

// ── Event Chip ──

function EventChip({
  event,
  isSelected,
  onClick,
  compact
}: {
  event: CalendarEvent;
  isSelected: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);
  const isAutoBooked = event.isAutoBooked;

  return (
    <Flex
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      sx={{
        flexDirection: "column",
        bg: `${event.color}20`,
        borderLeft: `3px solid ${event.color}`,
        borderRadius: 4,
        px: 2,
        py: 1,
        cursor: "pointer",
        border: isSelected
          ? `2px solid ${event.color}`
          : isAutoBooked
          ? `1px dashed ${event.color}`
          : `1px solid ${event.color}30`,
        "&:hover": { bg: `${event.color}30` },
        overflow: "hidden",
        minHeight: compact ? "auto" : 30
      }}
    >
      <Text
        sx={{
          fontSize: 11,
          fontWeight: "bold",
          color: "heading",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {isAutoBooked ? "🕐 " : ""}{TYPE_ICONS[event.type]} {event.title}
      </Text>
      {!compact && !event.allDay && (
        <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
          {startDate.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit"
          })}{" "}
          –{" "}
          {endDate.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit"
          })}
        </Text>
      )}
      {event.allDay && (
        <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
          All day
        </Text>
      )}
    </Flex>
  );
}

// ── Editable Event Detail ──

function EventDetail({ event }: { event: CalendarEvent }) {
  const updateEvent = useCalendarStore((s) => s.updateEvent);
  const deleteEvent = useCalendarStore((s) => s.deleteEvent);
  const selectEvent = useCalendarStore((s) => s.selectEvent);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [type, setType] = useState(event.type);
  const [startTime, setStartTime] = useState(toDateTimeLocal(event.startTime));
  const [endTime, setEndTime] = useState(toDateTimeLocal(event.endTime));
  const [allDay, setAllDay] = useState(event.allDay);
  const [color, setColor] = useState(event.color);
  const [attendeesStr, setAttendeesStr] = useState(event.attendees.join(", "));

  const types: CalendarEventType[] = ["meeting", "deadline", "reminder", "block"];

  const handleSave = () => {
    const start = fromDateTimeLocal(startTime);
    const end = allDay ? start : fromDateTimeLocal(endTime);
    updateEvent(event.id, {
      title: title.trim() || event.title,
      description: description.trim(),
      type,
      startTime: start,
      endTime: end,
      allDay,
      color,
      attendees: attendeesStr
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
    });
    setEditing(false);
  };

  const handleDelete = () => {
    deleteEvent(event.id);
  };

  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);

  if (editing) {
    return (
      <Flex
        sx={{
          flexDirection: "column",
          bg: "background-secondary",
          borderRadius: 8,
          border: "1px solid var(--border)",
          p: 3,
          gap: 2,
          width: 300,
          flexShrink: 0,
          overflow: "auto"
        }}
      >
        <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}>
          Edit Event
        </Text>

        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          sx={{ fontSize: 13 }}
        />

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{
            fontSize: 12,
            padding: "8px",
            borderRadius: "4px",
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--paragraph)",
            resize: "vertical",
            minHeight: "50px",
            fontFamily: "inherit"
          }}
        />

        <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
          {types.map((t) => (
            <Button
              key={t}
              variant={type === t ? "accent" : "secondary"}
              sx={{ fontSize: 10, px: 1, py: "2px", textTransform: "capitalize" }}
              onClick={() => setType(t)}
            >
              {TYPE_ICONS[t]} {t}
            </Button>
          ))}
        </Flex>

        <Flex
          sx={{ alignItems: "center", gap: 2, cursor: "pointer" }}
          onClick={() => setAllDay(!allDay)}
        >
          <Box
            sx={{
              width: 14,
              height: 14,
              borderRadius: 2,
              border: "2px solid var(--border)",
              bg: allDay ? "accent" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            {allDay && (
              <Text sx={{ fontSize: 9, color: "white", lineHeight: 1 }}>✓</Text>
            )}
          </Box>
          <Text sx={{ fontSize: 11, color: "paragraph" }}>All day</Text>
        </Flex>

        <input
          type={allDay ? "date" : "datetime-local"}
          value={allDay ? startTime.split("T")[0] : startTime}
          onChange={(e) =>
            setStartTime(allDay ? e.target.value + "T00:00" : e.target.value)
          }
          style={{
            fontSize: 11,
            padding: "4px 6px",
            borderRadius: "4px",
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--paragraph)",
            fontFamily: "inherit"
          }}
        />
        {!allDay && (
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={{
              fontSize: 11,
              padding: "4px 6px",
              borderRadius: "4px",
              border: "1px solid var(--border)",
              background: "var(--background)",
              color: "var(--paragraph)",
              fontFamily: "inherit"
            }}
          />
        )}

        <Flex sx={{ gap: 1 }}>
          {EVENT_COLORS.map((c) => (
            <Box
              key={c}
              onClick={() => setColor(c)}
              sx={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                bg: c,
                cursor: "pointer",
                border:
                  color === c ? "2px solid var(--heading)" : "2px solid transparent"
              }}
            />
          ))}
        </Flex>

        <Input
          placeholder="Attendees (comma-separated)"
          value={attendeesStr}
          onChange={(e) => setAttendeesStr(e.target.value)}
          sx={{ fontSize: 11 }}
        />

        <Flex sx={{ gap: 1 }}>
          <Button
            variant="accent"
            sx={{ flex: 1, fontSize: 11 }}
            onClick={handleSave}
          >
            Save
          </Button>
          <Button
            variant="secondary"
            sx={{ fontSize: 11 }}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </Flex>
      </Flex>
    );
  }

  return (
    <Flex
      sx={{
        flexDirection: "column",
        bg: "background-secondary",
        borderRadius: 8,
        border: "1px solid var(--border)",
        p: 3,
        gap: 2,
        width: 300,
        flexShrink: 0
      }}
    >
      <Flex sx={{ alignItems: "center", gap: 2 }}>
        <Box
          sx={{
            width: 12,
            height: 12,
            borderRadius: 3,
            bg: event.color,
            flexShrink: 0
          }}
        />
        <Text sx={{ fontSize: 16, fontWeight: "bold", color: "heading", flex: 1 }}>
          {event.title}
        </Text>
      </Flex>

      {event.description && (
        <Text sx={{ fontSize: 12, color: "paragraph", lineHeight: 1.5 }}>
          {event.description}
        </Text>
      )}

      <Flex sx={{ flexDirection: "column", gap: 1 }}>
        <DetailRow label="Type" value={`${TYPE_ICONS[event.type]} ${event.type}`} />
        <DetailRow
          label="When"
          value={
            event.allDay
              ? startDate.toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric"
                })
              : `${startDate.toLocaleDateString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric"
                })} ${startDate.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit"
                })} – ${endDate.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit"
                })}`
          }
        />
        <DetailRow
          label="Created by"
          value={event.createdBy === "agent" ? "🤖 Agent" : "👤 You"}
        />
        {event.attendees.length > 0 && (
          <DetailRow
            label="Attendees"
            value={event.attendees.join(", ")}
          />
        )}
        {event.linkedTaskId && (
          <DetailRow label="Linked task" value={event.linkedTaskId} />
        )}
      </Flex>

      <Flex sx={{ gap: 1, mt: 1 }}>
        <Button
          variant="secondary"
          sx={{ flex: 1, fontSize: 11 }}
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        <Button
          variant="secondary"
          sx={{ fontSize: 11, color: "#ef4444" }}
          onClick={handleDelete}
        >
          Delete
        </Button>
        <Button
          variant="secondary"
          sx={{ fontSize: 11 }}
          onClick={() => selectEvent(null)}
        >
          Close
        </Button>
      </Flex>
    </Flex>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Flex sx={{ justifyContent: "space-between", alignItems: "center" }}>
      <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>{label}</Text>
      <Text sx={{ fontSize: 12, color: "heading", textAlign: "right" }}>
        {value}
      </Text>
    </Flex>
  );
}

// ── Week View ──

function WeekView() {
  const events = useCalendarStore((s) => s.events);
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const selectedEventId = useCalendarStore((s) => s.selectedEventId);
  const selectEvent = useCalendarStore((s) => s.selectEvent);

  const startOfWeek = getStartOfWeek(new Date(selectedDate));
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  return (
    <Flex sx={{ flex: 1, gap: 3, minHeight: 0 }}>
      <Flex sx={{ flex: 1, flexDirection: "column", overflow: "hidden" }}>
        {/* Day headers */}
        <Flex sx={{ pl: "50px" }}>
          {weekDays.map((day, i) => {
            const isToday = day.getTime() === today.getTime();
            return (
              <Flex
                key={i}
                sx={{
                  flex: 1,
                  flexDirection: "column",
                  alignItems: "center",
                  py: 1,
                  borderBottom: "1px solid var(--border)"
                }}
              >
                <Text
                  sx={{
                    fontSize: 11,
                    color: isToday ? "accent" : "paragraph-secondary",
                    fontWeight: isToday ? "bold" : "normal"
                  }}
                >
                  {DAYS[day.getDay()]}
                </Text>
                <Text
                  sx={{
                    fontSize: 16,
                    fontWeight: "bold",
                    color: isToday ? "accent" : "heading",
                    width: 28,
                    height: 28,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "50%",
                    bg: isToday ? "shade" : "transparent"
                  }}
                >
                  {day.getDate()}
                </Text>
              </Flex>
            );
          })}
        </Flex>

        {/* All-day events */}
        <Flex sx={{ pl: "50px", borderBottom: "1px solid var(--border)" }}>
          {weekDays.map((day, i) => {
            const dayStart = day.getTime();
            const dayEnd = dayStart + 86400000;
            const allDayEvents = events.filter(
              (e) => e.allDay && e.startTime >= dayStart && e.startTime < dayEnd
            );
            return (
              <Flex key={i} sx={{ flex: 1, flexDirection: "column", gap: "2px", p: "2px" }}>
                {allDayEvents.map((evt) => (
                  <EventChip
                    key={evt.id}
                    event={evt}
                    compact
                    isSelected={selectedEventId === evt.id}
                    onClick={() =>
                      selectEvent(selectedEventId === evt.id ? null : evt.id)
                    }
                  />
                ))}
              </Flex>
            );
          })}
        </Flex>

        {/* Time grid */}
        <Box sx={{ flex: 1, overflow: "auto" }}>
          <Flex sx={{ position: "relative" }}>
            {/* Time labels */}
            <Flex sx={{ flexDirection: "column", width: 50, flexShrink: 0 }}>
              {HOURS.map((hour) => (
                <Flex
                  key={hour}
                  sx={{
                    height: 60,
                    alignItems: "flex-start",
                    justifyContent: "flex-end",
                    pr: 1
                  }}
                >
                  <Text
                    sx={{
                      fontSize: 10,
                      color: "paragraph-secondary",
                      mt: "-6px"
                    }}
                  >
                    {formatHour(hour)}
                  </Text>
                </Flex>
              ))}
            </Flex>

            {/* Day columns */}
            {weekDays.map((day, dayIndex) => {
              const dayStart = day.getTime();
              const dayEnd = dayStart + 86400000;
              const dayEvents = events.filter(
                (e) =>
                  !e.allDay &&
                  e.startTime >= dayStart &&
                  e.startTime < dayEnd
              );

              return (
                <Flex
                  key={dayIndex}
                  sx={{
                    flex: 1,
                    flexDirection: "column",
                    position: "relative",
                    borderLeft: "1px solid var(--border)"
                  }}
                >
                  {/* Grid lines */}
                  {HOURS.map((hour) => (
                    <Box
                      key={hour}
                      sx={{
                        height: 60,
                        borderBottom: "1px solid var(--border)",
                        opacity: 0.5
                      }}
                    />
                  ))}

                  {/* Events */}
                  {dayEvents.map((evt) => {
                    const startHour =
                      new Date(evt.startTime).getHours() +
                      new Date(evt.startTime).getMinutes() / 60;
                    const endHour =
                      new Date(evt.endTime).getHours() +
                      new Date(evt.endTime).getMinutes() / 60;
                    const top = (startHour - 7) * 60;
                    const height = Math.max((endHour - startHour) * 60, 20);

                    return (
                      <Box
                        key={evt.id}
                        sx={{
                          position: "absolute",
                          top,
                          left: 2,
                          right: 2,
                          zIndex: 1
                        }}
                      >
                        <Box sx={{ height }}>
                          <EventChip
                            event={evt}
                            isSelected={selectedEventId === evt.id}
                            onClick={() =>
                              selectEvent(
                                selectedEventId === evt.id ? null : evt.id
                              )
                            }
                          />
                        </Box>
                      </Box>
                    );
                  })}
                </Flex>
              );
            })}
          </Flex>
        </Box>
      </Flex>

      {/* Detail panel */}
      {selectedEvent && <EventDetail event={selectedEvent} />}
    </Flex>
  );
}

// ── Auto-Book Panel ──

function AutoBookPanel() {
  const events = useCalendarStore((s) => s.events);
  const confirmAppointment = useCalendarStore((s) => s.confirmAppointment);
  const declineAppointment = useCalendarStore((s) => s.declineAppointment);

  const pendingAutoBooked = events.filter(
    (e) => e.isAutoBooked && e.confirmationStatus === "pending"
  );

  if (pendingAutoBooked.length === 0) return null;

  return (
    <Flex
      sx={{
        flexDirection: "column",
        bg: "background-secondary",
        borderRadius: 8,
        border: "1px dashed #22c55e50",
        p: "12px",
        gap: 2
      }}
    >
      <Flex sx={{ alignItems: "center", gap: 1 }}>
        <Text sx={{ fontSize: 12 }}>🕐</Text>
        <Text
          sx={{
            fontSize: 11,
            fontWeight: "bold",
            color: "paragraph-secondary",
            textTransform: "uppercase",
            letterSpacing: "1px"
          }}
        >
          Pending Auto-Booked Appointments ({pendingAutoBooked.length})
        </Text>
      </Flex>

      {pendingAutoBooked.map((evt) => {
        const startDate = new Date(evt.startTime);
        const endDate = new Date(evt.endTime);
        return (
          <Flex
            key={evt.id}
            sx={{
              alignItems: "center",
              gap: 2,
              py: "6px",
              px: 2,
              borderRadius: 6,
              border: `1px dashed ${evt.color}40`,
              bg: `${evt.color}08`
            }}
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bg: evt.color,
                flexShrink: 0
              }}
            />
            <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
              <Text
                sx={{
                  fontSize: 12,
                  fontWeight: "bold",
                  color: "heading",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {evt.title}
              </Text>
              <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
                {startDate.toLocaleDateString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric"
                })}{" "}
                {startDate.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit"
                })}{" "}
                –{" "}
                {endDate.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit"
                })}
                {evt.clientName && ` · ${evt.clientName}`}
                {evt.clientContact && ` (${evt.clientContact})`}
              </Text>
            </Flex>
            <Flex sx={{ gap: 1, flexShrink: 0 }}>
              <Button
                variant="accent"
                sx={{ fontSize: 10, px: 2, py: "3px" }}
                onClick={() => confirmAppointment(evt.id)}
              >
                Confirm
              </Button>
              <Button
                variant="secondary"
                sx={{ fontSize: 10, px: 2, py: "3px", color: "#ef4444" }}
                onClick={() => declineAppointment(evt.id)}
              >
                Decline
              </Button>
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  );
}

// ── Main Calendar View ──

function CalendarView() {
  const viewMode = useCalendarStore((s) => s.viewMode);
  const setViewMode = useCalendarStore((s) => s.setViewMode);
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const setSelectedDate = useCalendarStore((s) => s.setSelectedDate);
  const events = useCalendarStore((s) => s.events);
  const [showNewEvent, setShowNewEvent] = useState(false);

  // Listen for dashboard quick-create event
  useEffect(() => {
    const sub = AppEventManager.subscribe(AppEvents.createNewEvent, () => {
      setShowNewEvent(true);
    });
    return () => sub.unsubscribe();
  }, []);

  const startOfWeek = getStartOfWeek(new Date(selectedDate));
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 6);

  const todayEvents = events.filter((e) => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayEnd = dayStart + 86400000;
    return e.startTime >= dayStart && e.startTime < dayEnd;
  });

  const viewModes: CalendarViewMode[] = ["day", "week", "month"];

  return (
    <Flex
      sx={{
        flex: 1,
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        p: 3,
        gap: 3
      }}
    >
      {/* Header */}
      <Flex sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Flex sx={{ flexDirection: "column" }}>
          <Text variant="heading" sx={{ fontSize: 22 }}>
            Calendar
          </Text>
          <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
            {startOfWeek.toLocaleDateString([], {
              month: "long",
              day: "numeric"
            })}{" "}
            –{" "}
            {endOfWeek.toLocaleDateString([], {
              month: "long",
              day: "numeric",
              year: "numeric"
            })}{" "}
            &middot; {todayEvents.length} events today
          </Text>
        </Flex>

        <Flex sx={{ gap: 1, alignItems: "center" }}>
          <Button
            variant="accent"
            sx={{ fontSize: 12, px: 2, py: 1 }}
            onClick={() => setShowNewEvent(!showNewEvent)}
          >
            {showNewEvent ? "Cancel" : "+ New Event"}
          </Button>
          <Button
            variant="secondary"
            sx={{ fontSize: 12, px: 2, py: 1 }}
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 7);
              setSelectedDate(d.getTime());
            }}
          >
            ←
          </Button>
          <Button
            variant="secondary"
            sx={{ fontSize: 12, px: 2, py: 1 }}
            onClick={() => setSelectedDate(Date.now())}
          >
            Today
          </Button>
          <Button
            variant="secondary"
            sx={{ fontSize: 12, px: 2, py: 1 }}
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + 7);
              setSelectedDate(d.getTime());
            }}
          >
            →
          </Button>

          <Flex sx={{ gap: 1, ml: 2 }}>
            {viewModes.map((mode) => (
              <Button
                key={mode}
                variant={viewMode === mode ? "accent" : "secondary"}
                sx={{
                  fontSize: 11,
                  px: 2,
                  py: 1,
                  textTransform: "capitalize"
                }}
                onClick={() => setViewMode(mode)}
              >
                {mode}
              </Button>
            ))}
          </Flex>
        </Flex>
      </Flex>

      {/* Auto-booked appointments pending confirmation */}
      <AutoBookPanel />

      {/* Calendar body with optional new event form */}
      {showNewEvent ? (
        <Flex sx={{ flex: 1, gap: 3, minHeight: 0 }}>
          <Box sx={{ flex: 1, overflow: "hidden" }}>
            <WeekView />
          </Box>
          <NewEventForm onClose={() => setShowNewEvent(false)} />
        </Flex>
      ) : (
        <WeekView />
      )}
    </Flex>
  );
}

export default CalendarView;
