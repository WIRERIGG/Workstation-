# Plan: Merge BusinessDesk OS Features into Workstation

## Overview

Adapt the BusinessDesk OS PRD features into the existing Workstation app using its Theme UI + Zustand architecture. No new dependencies needed — everything maps to existing patterns.

### Feature Mapping: PRD → Workstation

| BusinessDesk PRD Feature | Workstation Target | Action |
|---|---|---|
| Onboarding Wizard (25 questions, 5 steps) | New dialog via `DialogManager` | **Create** |
| Branding (name, logo, color, industry) | New `branding-store.ts` | **Create** |
| Activity Feed | `views/dashboard.tsx` | Already done (Phase 2 filters) |
| Call History + Transcripts + Sentiment | `views/communications.tsx` | **Enhance** |
| Email AI Drafts | `views/communications.tsx` | Already exists (`agentDraftReply`) |
| Scheduler / Auto-Book | `views/calendar.tsx` | **Enhance** |
| Newsletter Composer | New `views/newsletters.tsx` | **Create** |
| Live Call Queue | New `views/call-queue.tsx` | **Create** |
| Risk & Opportunity Alerts | New dashboard widget | **Create** |
| Floating AI Command Bar ("Ask DeskAI") | Enhance `components/command-bar/` | **Enhance** |
| Business branding in header/sidebar | `navigation-menu/index.tsx` + `app.tsx` | **Modify** |

---

## Phase 1: Branding Store + Onboarding Wizard

### 1a. New `stores/branding-store.ts`
- Extends `BaseStore<BrandingStore>`
- State: `businessName`, `industry`, `teamSize`, `logo` (data URL), `primaryColor`, `preferredTone`, `primaryGoal`, `emailVolume`, `callVolume`, `isOnboarded`
- Advanced toggles: `wantsAutoScheduling`, `wantsNewsletters`, `wantsCallbacks`, `wantsMultiCall`
- Persistence via localStorage (`workstation:branding`)
- Methods: `completeOnboarding(data)`, `updateBranding(partial)`, `resetBranding()`

### 1b. New `dialogs/onboarding-wizard-dialog.tsx`
- Registered via `DialogManager.register()`
- 5-step wizard following PRD structure:
  1. Business Basics (name, industry, team size)
  2. Daily Workflows (email volume, call volume, primary goal)
  3. Tone & Guardrails (preferred tone, communication style)
  4. Advanced Features (toggles: auto-scheduling, newsletters, callbacks, multi-call)
  5. Review & Finish (summary + launch button)
- Uses Theme UI `Flex`, `Box`, `Text`, `Input`, `Button`
- Step indicator at top (numbered dots with labels)
- Back/Next navigation; Finish calls `brandingStore.completeOnboarding()`

### 1c. Modify `app.tsx`
- Import branding store
- On mount: if `!isOnboarded`, show `OnboardingWizardDialog.show({})`
- Apply `primaryColor` as CSS custom property on root

### 1d. Modify `navigation-menu/index.tsx`
- Replace hardcoded "Workstation" text with `branding.businessName + " Desk"`
- Tint header area with `branding.primaryColor`

**Files:**
- `stores/branding-store.ts` — **New**
- `dialogs/onboarding-wizard-dialog.tsx` — **New**
- `app.tsx` — Modify (add onboarding check)
- `navigation-menu/index.tsx` — Modify (branding name/color)

---

## Phase 2: Call History Enhancements (Communications)

### 2a. Extend `CommsMessage` type in `stores/comms-store.ts`
- Add `transcript?: string` — full call transcript text
- Add `sentiment?: "positive" | "neutral" | "negative"` — AI-analyzed sentiment
- Add `duration?: number` — call duration in seconds
- Add `callbackRequested?: boolean`

### 2b. Enhance `views/communications.tsx`
- **Transcript Viewer**: When viewing a phone-channel message with `transcript`, show expandable transcript panel below the body
- **Sentiment Badge**: Color-coded pill next to phone messages (green/gray/red)
- **Duration Display**: Show `mm:ss` duration for phone messages
- **Callback Flag**: Show callback-requested badge, quick action to create callback task

### 2c. Add mock phone messages with transcripts
- 3-4 sample call entries in `createDefaultComms()` with realistic transcripts and sentiments

**Files:**
- `stores/comms-store.ts` — Modify (extend type + mock data)
- `views/communications.tsx` — Modify (transcript viewer, sentiment, duration)

---

## Phase 3: Scheduler / Auto-Book (Calendar)

### 3a. Extend `CalendarEvent` in `stores/calendar-store.ts`
- Add `isAutoBooked?: boolean` — flag for auto-scheduled events
- Add `confirmationStatus?: "pending" | "confirmed" | "declined"`
- Add `clientName?: string` — for appointment bookings
- Add `clientContact?: string` — email/phone

### 3b. Add auto-scheduling methods to `calendar-store.ts`
- `autoBookAppointment(params)` — creates event with `isAutoBooked: true`
- `confirmAppointment(eventId)` / `declineAppointment(eventId)`
- `getAutoBookedEvents()` — filter

### 3c. Enhance `views/calendar.tsx`
- **Auto-Book Panel**: New section below calendar showing pending auto-booked appointments
- **Confirmation Actions**: Accept/Decline buttons on auto-booked events
- **Visual Distinction**: Auto-booked events get dashed border + clock icon
- Gate behind `branding.wantsAutoScheduling` toggle

**Files:**
- `stores/calendar-store.ts` — Modify (extend type + methods)
- `views/calendar.tsx` — Modify (auto-book panel + visual distinction)

---

## Phase 4: Newsletter Composer

### 4a. New `stores/newsletter-store.ts`
- `Newsletter` type: `id`, `title`, `body`, `status` (draft/scheduled/sent), `scheduledAt`, `recipientCount`, `createdAt`, `generatedBy` (agent/human)
- Methods: `createNewsletter()`, `updateNewsletter()`, `deleteNewsletter()`, `scheduleNewsletter()`, `generateDraft()` (simulates AI generation)
- Default drafts: 2-3 sample newsletters

### 4b. New `views/newsletters.tsx`
- **List Panel** (left): Newsletter cards with status badges
- **Editor Panel** (right): Title + body editing
- **AI Generate Button**: Populates body with mock AI-generated content based on branding industry
- **Schedule Section**: Date picker + recipient count estimate
- **Status Flow**: Draft → Scheduled → Sent
- Gate behind `branding.wantsNewsletters` toggle

### 4c. Add route + sidebar item
- `routes.tsx`: Add `/newsletters` route
- `navigation-menu/index.tsx`: Add "Newsletters" to Tools section with icon

**Files:**
- `stores/newsletter-store.ts` — **New**
- `views/newsletters.tsx` — **New**
- `navigation/routes.tsx` — Modify (add route)
- `navigation-menu/index.tsx` — Modify (add sidebar item)

---

## Phase 5: Live Call Queue

### 5a. New `stores/call-queue-store.ts`
- `QueuedCall` type: `id`, `callerName`, `callerPhone`, `waitTime`, `reason`, `priority`, `assignedAgent`, `status` (waiting/active/completed/missed)
- Methods: `addToQueue()`, `pickUpCall()`, `transferCall()`, `completeCall()`, `missCall()`
- Mock data: 3-5 queued calls with varied wait times
- `getQueueStats()`: calls waiting, average wait, longest wait

### 5b. New `views/call-queue.tsx`
- **Queue Table**: Sortable by wait time/priority
- **Status indicators**: Color-coded (waiting=yellow, active=green, missed=red)
- **Quick Actions**: Pick Up, Transfer to Agent, Complete
- **Stats Bar**: Calls waiting, avg wait time, missed today
- **Auto-refresh simulation**: Timer that increments wait times every second
- Gate behind `branding.wantsCallbacks` toggle

### 5c. Add route + sidebar item
- `routes.tsx`: Add `/call-queue` route
- `navigation-menu/index.tsx`: Add "Call Queue" to Tools section

**Files:**
- `stores/call-queue-store.ts` — **New**
- `views/call-queue.tsx` — **New**
- `navigation/routes.tsx` — Modify (add route)
- `navigation-menu/index.tsx` — Modify (add sidebar item)

---

## Phase 6: Risk & Opportunity Alerts (Dashboard Widget)

### 6a. Modify `views/dashboard.tsx`
- New `RiskAlertsWidget` component
- Types: `RiskAlert` with `id`, `type` ("risk" | "opportunity"), `severity` ("low" | "medium" | "high"), `title`, `description`, `source`, `timestamp`, `isAcknowledged`
- Generate alerts from existing store data:
  - Risk: overdue tasks, unread emails > 24h, missed calls, declined appointments
  - Opportunity: positive-sentiment calls, recurring client patterns, follow-up candidates
- Display as compact card list with severity-colored left border
- Acknowledge/dismiss actions
- Add to three-column top section or as a standalone card below existing widgets

**Files:**
- `views/dashboard.tsx` — Modify (add risk/opportunity widget)

---

## Phase 7: Enhanced Command Bar ("Ask DeskAI")

### 7a. Modify `components/command-bar/index.tsx`
- Add "AI Actions" command category with PRD examples:
  - "Summarize today's calls"
  - "Draft a reply to [most recent email]"
  - "Book an appointment for tomorrow at 2pm"
  - "Generate this week's newsletter"
  - "Show overdue tasks"
- Natural language input mode: when user types a full sentence (not matching a command), route to agent chat
- Visual refresh: larger command icon matching PRD's sparkle (✦) design

### 7b. Modify `components/agent-chat/` (if exists)
- Integrate command bar results → chat panel for conversational follow-up

**Files:**
- `components/command-bar/index.tsx` — Modify (add AI commands + NL mode)

---

## Implementation Order

```
Phase 1 (Branding + Onboarding) ─── foundation for all phases
  │
  ├─→ Phase 2 (Call History enhancements)
  ├─→ Phase 3 (Scheduler/Auto-Book)
  ├─→ Phase 4 (Newsletter Composer) ─ needs sidebar + route
  ├─→ Phase 5 (Call Queue) ─ needs sidebar + route
  ├─→ Phase 6 (Risk Alerts widget)
  └─→ Phase 7 (Enhanced Command Bar)
```

**Recommended sequence:** 1 → 6 → 2 → 3 → 7 → 4 → 5

Rationale: Phase 1 (branding) is the foundation. Phase 6 (risk alerts) is a small dashboard addition that demonstrates the business intelligence value. Phases 2-3 enhance existing views (lower risk). Phase 7 ties the AI story together. Phases 4-5 are net-new views (most code).

---

## Files Summary

| File | Action | Phase |
|---|---|---|
| `stores/branding-store.ts` | **New** | 1 |
| `dialogs/onboarding-wizard-dialog.tsx` | **New** | 1 |
| `app.tsx` | Modify | 1 |
| `navigation-menu/index.tsx` | Modify | 1, 4, 5 |
| `stores/comms-store.ts` | Modify | 2 |
| `views/communications.tsx` | Modify | 2 |
| `stores/calendar-store.ts` | Modify | 3 |
| `views/calendar.tsx` | Modify | 3 |
| `stores/newsletter-store.ts` | **New** | 4 |
| `views/newsletters.tsx` | **New** | 4 |
| `stores/call-queue-store.ts` | **New** | 5 |
| `views/call-queue.tsx` | **New** | 5 |
| `views/dashboard.tsx` | Modify | 6 |
| `components/command-bar/index.tsx` | Modify | 7 |
| `navigation/routes.tsx` | Modify | 4, 5 |

**New files: 6 | Modified files: 9 | Total: 15**

---

## Verification

1. `npx tsc --noEmit` — zero new errors in all modified/new files
2. First launch → Onboarding wizard appears with 5 steps
3. After onboarding → sidebar shows business name, header tinted with brand color
4. Communications → phone messages show transcript viewer + sentiment badges
5. Calendar → auto-booked events with confirm/decline
6. Dashboard → risk/opportunity alerts widget
7. `/newsletters` → list + editor + AI generate button
8. `/call-queue` → queue table with live wait-time counter
9. Command bar → AI action commands work
10. All Pro+ features respect branding toggles (auto-scheduling, newsletters, callbacks)
