/*
This file is part of the Workstation project

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

import { useState, useCallback } from "react";
import { Box, Flex, Text, Button, Input, Label } from "@theme-ui/components";
import Dialog from "../components/dialog";
import { BaseDialogProps, DialogManager } from "../common/dialog-manager";
import {
  store as brandingStore,
  type BrandingData,
  type Industry,
  type TeamSize,
  type EmailVolume,
  type CallVolume,
  type PreferredTone,
  type PrimaryGoal
} from "../stores/branding-store";

const STEPS = [
  "Business Basics",
  "Daily Workflows",
  "Tone & Style",
  "Advanced Features",
  "Review & Launch"
] as const;

const INDUSTRIES: { value: Industry; label: string }[] = [
  { value: "technology", label: "Technology" },
  { value: "finance", label: "Finance" },
  { value: "healthcare", label: "Healthcare" },
  { value: "retail", label: "Retail" },
  { value: "consulting", label: "Consulting" },
  { value: "real-estate", label: "Real Estate" },
  { value: "legal", label: "Legal" },
  { value: "marketing", label: "Marketing" },
  { value: "education", label: "Education" },
  { value: "other", label: "Other" }
];

const TEAM_SIZES: { value: TeamSize; label: string }[] = [
  { value: "solo", label: "Just me" },
  { value: "2-5", label: "2-5 people" },
  { value: "6-20", label: "6-20 people" },
  { value: "21-50", label: "21-50 people" },
  { value: "50+", label: "50+" }
];

const EMAIL_VOLUMES: { value: EmailVolume; label: string }[] = [
  { value: "low", label: "< 20/day" },
  { value: "medium", label: "20-50/day" },
  { value: "high", label: "50-100/day" },
  { value: "very-high", label: "100+/day" }
];

const CALL_VOLUMES: { value: CallVolume; label: string }[] = [
  { value: "none", label: "None" },
  { value: "low", label: "A few/week" },
  { value: "medium", label: "Several/day" },
  { value: "high", label: "20+/day" }
];

const TONES: { value: PreferredTone; label: string; desc: string }[] = [
  { value: "professional", label: "Professional", desc: "Polished and business-appropriate" },
  { value: "friendly", label: "Friendly", desc: "Warm and approachable" },
  { value: "casual", label: "Casual", desc: "Relaxed and conversational" },
  { value: "formal", label: "Formal", desc: "Structured and authoritative" },
  { value: "concise", label: "Concise", desc: "Brief and to the point" }
];

const GOALS: { value: PrimaryGoal; label: string }[] = [
  { value: "productivity", label: "Boost productivity" },
  { value: "client-management", label: "Manage clients" },
  { value: "team-coordination", label: "Coordinate team" },
  { value: "sales", label: "Drive sales" },
  { value: "support", label: "Customer support" },
  { value: "general", label: "General workspace" }
];

type WizardState = Omit<BrandingData, "isOnboarded">;

const DEFAULT_STATE: WizardState = {
  businessName: "",
  industry: "technology",
  teamSize: "solo",
  logo: "",
  primaryColor: "#E00000",
  preferredTone: "professional",
  primaryGoal: "productivity",
  emailVolume: "medium",
  callVolume: "low",
  wantsAutoScheduling: false,
  wantsNewsletters: false,
  wantsCallbacks: false,
  wantsMultiCall: false
};

function SelectGrid<T extends string>({
  options,
  value,
  onChange,
  columns = 3
}: {
  options: { value: T; label: string; desc?: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <Flex sx={{ flexWrap: "wrap", gap: 2 }}>
      {options.map((opt) => (
        <Button
          key={opt.value}
          variant="secondary"
          onClick={() => onChange(opt.value)}
          sx={{
            flex: `0 0 calc(${100 / columns}% - 8px)`,
            minWidth: 0,
            py: "6px",
            px: 2,
            textAlign: "left",
            bg: value === opt.value ? "shade" : "transparent",
            border: "1px solid",
            borderColor: value === opt.value ? "accent" : "border",
            borderRadius: "default",
            cursor: "pointer",
            "&:hover": { borderColor: "accent" }
          }}
        >
          <Text
            sx={{
              fontSize: "body",
              fontWeight: value === opt.value ? "bold" : "normal",
              color: value === opt.value ? "accent" : "paragraph"
            }}
          >
            {opt.label}
          </Text>
          {opt.desc ? (
            <Text sx={{ fontSize: 11, color: "paragraph-secondary", mt: "2px" }}>
              {opt.desc}
            </Text>
          ) : null}
        </Button>
      ))}
    </Flex>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Flex
      onClick={() => onChange(!checked)}
      sx={{
        py: 2,
        px: 2,
        alignItems: "center",
        justifyContent: "space-between",
        bg: checked ? "shade" : "transparent",
        border: "1px solid",
        borderColor: checked ? "accent" : "border",
        borderRadius: "default",
        cursor: "pointer",
        "&:hover": { borderColor: "accent" }
      }}
    >
      <Flex sx={{ flexDirection: "column", flex: 1, mr: 2 }}>
        <Text sx={{ fontSize: "body", fontWeight: "bold" }}>{label}</Text>
        <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>{description}</Text>
      </Flex>
      <Box
        sx={{
          width: 36,
          height: 20,
          borderRadius: 10,
          bg: checked ? "accent" : "border",
          position: "relative",
          flexShrink: 0,
          transition: "background 0.2s"
        }}
      >
        <Box
          sx={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            bg: "white",
            position: "absolute",
            top: "2px",
            left: checked ? "18px" : "2px",
            transition: "left 0.2s"
          }}
        />
      </Box>
    </Flex>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <Flex sx={{ alignItems: "center", justifyContent: "center", gap: 1, mb: 3 }}>
      {Array.from({ length: total }, (_, i) => (
        <Flex key={i} sx={{ alignItems: "center", gap: 1 }}>
          <Flex
            sx={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: "bold",
              bg: i <= current ? "accent" : "background-secondary",
              color: i <= current ? "white" : "paragraph-secondary",
              border: "1px solid",
              borderColor: i <= current ? "accent" : "border"
            }}
          >
            {i + 1}
          </Flex>
          {i < total - 1 ? (
            <Box
              sx={{
                width: 24,
                height: 2,
                bg: i < current ? "accent" : "border"
              }}
            />
          ) : null}
        </Flex>
      ))}
    </Flex>
  );
}

function Step1BusinessBasics({
  state,
  update
}: {
  state: WizardState;
  update: (partial: Partial<WizardState>) => void;
}) {
  return (
    <Flex sx={{ flexDirection: "column", gap: 3 }}>
      <Box>
        <Label htmlFor="businessName" sx={{ fontSize: "body", fontWeight: "bold", mb: 1 }}>
          Business Name
        </Label>
        <Input
          id="businessName"
          placeholder="e.g. Acme Corp"
          value={state.businessName}
          onChange={(e) => update({ businessName: e.target.value })}
          sx={{ fontSize: "body" }}
          autoFocus
        />
      </Box>

      <Box>
        <Text sx={{ fontSize: "body", fontWeight: "bold", mb: 2 }}>Industry</Text>
        <SelectGrid options={INDUSTRIES} value={state.industry} onChange={(v) => update({ industry: v })} columns={3} />
      </Box>

      <Box>
        <Text sx={{ fontSize: "body", fontWeight: "bold", mb: 2 }}>Team Size</Text>
        <SelectGrid options={TEAM_SIZES} value={state.teamSize} onChange={(v) => update({ teamSize: v })} columns={3} />
      </Box>

      <Box>
        <Label htmlFor="brandColor" sx={{ fontSize: "body", fontWeight: "bold", mb: 1 }}>
          Brand Color
        </Label>
        <Flex sx={{ alignItems: "center", gap: 2 }}>
          <Input
            id="brandColor"
            type="color"
            value={state.primaryColor}
            onChange={(e) => update({ primaryColor: e.target.value })}
            sx={{ width: 48, height: 36, p: 0, border: "none", cursor: "pointer" }}
          />
          <Text sx={{ fontSize: "body", color: "paragraph-secondary", fontFamily: "monospace" }}>
            {state.primaryColor}
          </Text>
        </Flex>
      </Box>
    </Flex>
  );
}

function Step2DailyWorkflows({
  state,
  update
}: {
  state: WizardState;
  update: (partial: Partial<WizardState>) => void;
}) {
  return (
    <Flex sx={{ flexDirection: "column", gap: 3 }}>
      <Box>
        <Text sx={{ fontSize: "body", fontWeight: "bold", mb: 2 }}>Daily Email Volume</Text>
        <SelectGrid options={EMAIL_VOLUMES} value={state.emailVolume} onChange={(v) => update({ emailVolume: v })} columns={2} />
      </Box>

      <Box>
        <Text sx={{ fontSize: "body", fontWeight: "bold", mb: 2 }}>Call Volume</Text>
        <SelectGrid options={CALL_VOLUMES} value={state.callVolume} onChange={(v) => update({ callVolume: v })} columns={2} />
      </Box>

      <Box>
        <Text sx={{ fontSize: "body", fontWeight: "bold", mb: 2 }}>Primary Goal</Text>
        <SelectGrid options={GOALS} value={state.primaryGoal} onChange={(v) => update({ primaryGoal: v })} columns={2} />
      </Box>
    </Flex>
  );
}

function Step3ToneStyle({
  state,
  update
}: {
  state: WizardState;
  update: (partial: Partial<WizardState>) => void;
}) {
  return (
    <Flex sx={{ flexDirection: "column", gap: 3 }}>
      <Box>
        <Text sx={{ fontSize: "body", fontWeight: "bold", mb: 1 }}>
          Communication Tone
        </Text>
        <Text sx={{ fontSize: "body", color: "paragraph-secondary", mb: 2 }}>
          How should your AI agents communicate on your behalf?
        </Text>
        <SelectGrid options={TONES} value={state.preferredTone} onChange={(v) => update({ preferredTone: v })} columns={2} />
      </Box>
    </Flex>
  );
}

function Step4AdvancedFeatures({
  state,
  update
}: {
  state: WizardState;
  update: (partial: Partial<WizardState>) => void;
}) {
  return (
    <Flex sx={{ flexDirection: "column", gap: 2 }}>
      <Text sx={{ fontSize: "body", color: "paragraph-secondary", mb: 1 }}>
        Enable the features you need. You can change these later in Settings.
      </Text>

      <ToggleRow
        label="Auto-Scheduling"
        description="AI books appointments and manages your calendar automatically"
        checked={state.wantsAutoScheduling}
        onChange={(v) => update({ wantsAutoScheduling: v })}
      />
      <ToggleRow
        label="Newsletters"
        description="AI-generated newsletter drafts for your audience"
        checked={state.wantsNewsletters}
        onChange={(v) => update({ wantsNewsletters: v })}
      />
      <ToggleRow
        label="Callback Queue"
        description="Track incoming calls and manage callback requests"
        checked={state.wantsCallbacks}
        onChange={(v) => update({ wantsCallbacks: v })}
      />
      <ToggleRow
        label="Multi-Call Management"
        description="Handle multiple concurrent calls with AI assist"
        checked={state.wantsMultiCall}
        onChange={(v) => update({ wantsMultiCall: v })}
      />
    </Flex>
  );
}

function Step5Review({ state }: { state: WizardState }) {
  const enabledFeatures = [
    state.wantsAutoScheduling && "Auto-Scheduling",
    state.wantsNewsletters && "Newsletters",
    state.wantsCallbacks && "Callback Queue",
    state.wantsMultiCall && "Multi-Call"
  ].filter(Boolean);

  return (
    <Flex sx={{ flexDirection: "column", gap: 3 }}>
      <Flex
        sx={{
          p: 3,
          bg: "background-secondary",
          borderRadius: "default",
          flexDirection: "column",
          gap: 2
        }}
      >
        <Flex sx={{ alignItems: "center", gap: 2 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: "default",
              bg: state.primaryColor,
              flexShrink: 0
            }}
          />
          <Text sx={{ fontSize: "title", fontWeight: "bold" }}>
            {state.businessName || "Workstation"} Desk
          </Text>
        </Flex>

        <Box sx={{ height: 1, bg: "border" }} />

        <ReviewRow label="Industry" value={INDUSTRIES.find((i) => i.value === state.industry)?.label || state.industry} />
        <ReviewRow label="Team Size" value={TEAM_SIZES.find((t) => t.value === state.teamSize)?.label || state.teamSize} />
        <ReviewRow label="Email Volume" value={EMAIL_VOLUMES.find((e) => e.value === state.emailVolume)?.label || state.emailVolume} />
        <ReviewRow label="Call Volume" value={CALL_VOLUMES.find((c) => c.value === state.callVolume)?.label || state.callVolume} />
        <ReviewRow label="Primary Goal" value={GOALS.find((g) => g.value === state.primaryGoal)?.label || state.primaryGoal} />
        <ReviewRow label="Tone" value={TONES.find((t) => t.value === state.preferredTone)?.label || state.preferredTone} />

        {enabledFeatures.length > 0 ? (
          <>
            <Box sx={{ height: 1, bg: "border" }} />
            <ReviewRow label="Features" value={enabledFeatures.join(", ")} />
          </>
        ) : null}
      </Flex>

      <Text sx={{ fontSize: "body", color: "paragraph-secondary", textAlign: "center" }}>
        You can change any of these settings later.
      </Text>
    </Flex>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <Flex sx={{ justifyContent: "space-between", alignItems: "center" }}>
      <Text sx={{ fontSize: "body", color: "paragraph-secondary" }}>{label}</Text>
      <Text sx={{ fontSize: "body", fontWeight: "bold" }}>{value}</Text>
    </Flex>
  );
}

export const OnboardingWizardDialog = DialogManager.register(
  function OnboardingWizardDialog(props: BaseDialogProps<boolean>) {
    const [step, setStep] = useState(0);
    const [state, setState] = useState<WizardState>({ ...DEFAULT_STATE });

    const update = useCallback((partial: Partial<WizardState>) => {
      setState((prev) => ({ ...prev, ...partial }));
    }, []);

    const canProceed = step === 0 ? state.businessName.trim().length > 0 : true;

    const handleFinish = useCallback(() => {
      brandingStore.completeOnboarding(state);
      props.onClose(true);
    }, [state, props]);

    const stepContent = (() => {
      switch (step) {
        case 0:
          return <Step1BusinessBasics state={state} update={update} />;
        case 1:
          return <Step2DailyWorkflows state={state} update={update} />;
        case 2:
          return <Step3ToneStyle state={state} update={update} />;
        case 3:
          return <Step4AdvancedFeatures state={state} update={update} />;
        case 4:
          return <Step5Review state={state} />;
        default:
          return null;
      }
    })();

    return (
      <Dialog
        isOpen={true}
        title="Set Up Your Workspace"
        description={STEPS[step]}
        width={520}
        onClose={() => props.onClose(false)}
        positiveButton={{
          text: step === STEPS.length - 1 ? "Launch Workspace" : "Next",
          disabled: !canProceed,
          onClick: step === STEPS.length - 1 ? handleFinish : () => setStep((s) => s + 1)
        }}
        negativeButton={
          step > 0
            ? { text: "Back", onClick: () => setStep((s) => s - 1) }
            : { text: "Skip", onClick: () => props.onClose(false) }
        }
      >
        <Flex sx={{ flexDirection: "column" }}>
          <StepIndicator current={step} total={STEPS.length} />
          {stepContent}
        </Flex>
      </Dialog>
    );
  }
);
