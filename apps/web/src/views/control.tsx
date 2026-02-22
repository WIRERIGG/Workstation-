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

import { useEffect, useRef, useState } from "react";
import { Box, Button, Flex, Input, Text, Textarea } from "@theme-ui/components";
import {
  useStore as useOpenClawStore,
  type ChannelStatusPayload,
  type GatewaySession,
  type CronJob,
  type GatewaySkill,
  type ExecApproval,
  type ConfigSchemaNode,
  type TokenUsageEntry,
  type PresenceNode
} from "../stores/openclaw-store";

type ControlTab =
  | "channels"
  | "sessions"
  | "cron"
  | "skills"
  | "exec"
  | "config"
  | "tokens"
  | "presence";

const TABS: { id: ControlTab; label: string }[] = [
  { id: "channels", label: "Channels" },
  { id: "sessions", label: "Sessions" },
  { id: "cron", label: "Cron" },
  { id: "skills", label: "Skills" },
  { id: "exec", label: "Exec Approvals" },
  { id: "config", label: "Config" },
  { id: "tokens", label: "Token Usage" },
  { id: "presence", label: "Presence" }
];

// ── Helpers ──

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatusDot({ color }: { color: string }) {
  return (
    <Box
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        bg: color,
        flexShrink: 0,
        boxShadow: `0 0 6px ${color}`
      }}
    />
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Flex
      sx={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        py: 5,
        color: "paragraph-secondary"
      }}
    >
      <Text sx={{ fontSize: 14 }}>{message}</Text>
    </Flex>
  );
}

function DisconnectedGuard({ children }: { children: React.ReactNode }) {
  const connected = useOpenClawStore((s) => s.connectionState === "connected");
  if (!connected) {
    return (
      <Flex
        sx={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 2,
          py: 5
        }}
      >
        <StatusDot color="#6b7280" />
        <Text sx={{ color: "paragraph-secondary", fontSize: 14 }}>
          Not connected to OpenClaw Gateway
        </Text>
      </Flex>
    );
  }
  return <>{children}</>;
}

function SectionCard({
  children,
  sx
}: {
  children: React.ReactNode;
  sx?: Record<string, unknown>;
}) {
  return (
    <Box
      sx={{
        bg: "background-secondary",
        border: "1px solid var(--border)",
        borderRadius: 8,
        p: 3,
        ...sx
      }}
    >
      {children}
    </Box>
  );
}

// ── Channels Panel ──

function ChannelsPanel() {
  const channels = useOpenClawStore((s) => s.channels);
  const loading = useOpenClawStore((s) => s.channelsLoading);
  const refresh = useOpenClawStore((s) => s.refreshChannels);

  useEffect(() => {
    refresh();
  }, []);

  const statusColor: Record<string, string> = {
    connected: "#22c55e",
    disconnected: "#6b7280",
    pending_qr: "#f59e0b",
    error: "#ef4444"
  };

  if (loading && channels.length === 0) return <EmptyState message="Loading channels..." />;
  if (channels.length === 0) return <EmptyState message="No channels configured" />;

  return (
    <Flex sx={{ flexWrap: "wrap", gap: 3 }}>
      {channels.map((ch) => (
        <SectionCard key={ch.channel} sx={{ minWidth: 260, flex: "1 1 45%" }}>
          <Flex sx={{ alignItems: "center", gap: 2, mb: 2 }}>
            <StatusDot color={statusColor[ch.status] || "#6b7280"} />
            <Text sx={{ fontWeight: "bold", fontSize: 14 }}>{ch.channel}</Text>
            <Text
              sx={{
                fontSize: 10,
                px: "6px",
                py: "2px",
                borderRadius: 4,
                bg: `${statusColor[ch.status]}15`,
                color: statusColor[ch.status],
                fontWeight: "bold",
                textTransform: "uppercase",
                ml: "auto"
              }}
            >
              {ch.status.replace("_", " ")}
            </Text>
          </Flex>
          {ch.phone && (
            <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>
              Phone: {ch.phone}
            </Text>
          )}
          {ch.handle && (
            <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>
              Handle: {ch.handle}
            </Text>
          )}
          {ch.error && (
            <Text sx={{ fontSize: 12, color: "#ef4444", mt: 1 }}>
              {ch.error}
            </Text>
          )}
          {ch.status === "pending_qr" && ch.qr_code && (
            <Box sx={{ mt: 2, textAlign: "center" }}>
              <img
                src={ch.qr_code}
                alt="QR Code"
                style={{ width: 160, height: 160, imageRendering: "pixelated" }}
              />
            </Box>
          )}
        </SectionCard>
      ))}
    </Flex>
  );
}

// ── Sessions Panel ──

function SessionsPanel() {
  const sessions = useOpenClawStore((s) => s.gatewaySessions);
  const loading = useOpenClawStore((s) => s.gatewaySessionsLoading);
  const refresh = useOpenClawStore((s) => s.refreshGatewaySessions);
  const patchSession = useOpenClawStore((s) => s.patchGatewaySession);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  const selected = sessions.find((s) => s.id === selectedId);

  const sessionStatusColor: Record<string, string> = {
    active: "#22c55e",
    completed: "#3b82f6",
    error: "#ef4444",
    idle: "#94a3b8"
  };

  if (loading && sessions.length === 0) return <EmptyState message="Loading sessions..." />;
  if (sessions.length === 0) return <EmptyState message="No active sessions" />;

  return (
    <Flex sx={{ gap: 3, flex: 1, minHeight: 0 }}>
      {/* Session list */}
      <Flex
        sx={{
          flexDirection: "column",
          width: "40%",
          gap: 1,
          overflow: "auto",
          borderRight: "1px solid var(--border)",
          pr: 2
        }}
      >
        {sessions.map((s) => (
          <Flex
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            sx={{
              alignItems: "center",
              gap: 2,
              p: 2,
              borderRadius: 6,
              cursor: "pointer",
              bg: selectedId === s.id ? "background-selected" : "transparent",
              "&:hover": { bg: "hover" }
            }}
          >
            <StatusDot color={sessionStatusColor[s.status] || "#6b7280"} />
            <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
              <Text sx={{ fontSize: 12, fontFamily: "monospace" }}>
                {s.id.slice(0, 12)}...
              </Text>
              {s.agent && (
                <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
                  {s.agent}
                </Text>
              )}
            </Flex>
            <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
              {formatTime(s.created_at)}
            </Text>
          </Flex>
        ))}
      </Flex>

      {/* Session detail */}
      <Flex sx={{ flexDirection: "column", flex: 1, gap: 2 }}>
        {selected ? (
          <>
            <Text sx={{ fontWeight: "bold", fontSize: 14 }}>Session Detail</Text>
            <SectionCard>
              <Flex sx={{ flexDirection: "column", gap: 2 }}>
                <DetailRow label="ID" value={selected.id} mono />
                <DetailRow label="Agent" value={selected.agent || "—"} />
                <DetailRow label="Model" value={selected.model || "—"} />
                <DetailRow label="Status" value={selected.status} />
                <DetailRow label="Created" value={formatTime(selected.created_at)} />
                {selected.message_count !== undefined && (
                  <DetailRow label="Messages" value={String(selected.message_count)} />
                )}
                <Flex sx={{ gap: 3, mt: 1 }}>
                  <Flex sx={{ alignItems: "center", gap: 2 }}>
                    <Text sx={{ fontSize: 12 }}>Thinking</Text>
                    <Button
                      variant="secondary"
                      sx={{ fontSize: 11, px: 2, py: 1 }}
                      onClick={() => patchSession(selected.id, { thinking: !selected.thinking })}
                    >
                      {selected.thinking ? "ON" : "OFF"}
                    </Button>
                  </Flex>
                  <Flex sx={{ alignItems: "center", gap: 2 }}>
                    <Text sx={{ fontSize: 12 }}>Verbose</Text>
                    <Button
                      variant="secondary"
                      sx={{ fontSize: 11, px: 2, py: 1 }}
                      onClick={() => patchSession(selected.id, { verbose: !selected.verbose })}
                    >
                      {selected.verbose ? "ON" : "OFF"}
                    </Button>
                  </Flex>
                </Flex>
              </Flex>
            </SectionCard>
          </>
        ) : (
          <EmptyState message="Select a session to view details" />
        )}
      </Flex>
    </Flex>
  );
}

function DetailRow({
  label,
  value,
  mono
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Flex sx={{ justifyContent: "space-between", alignItems: "center" }}>
      <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>{label}</Text>
      <Text
        sx={{ fontSize: 12, fontFamily: mono ? "monospace" : "inherit" }}
      >
        {value}
      </Text>
    </Flex>
  );
}

// ── Cron Panel ──

function CronPanel() {
  const jobs = useOpenClawStore((s) => s.cronJobs);
  const loading = useOpenClawStore((s) => s.cronLoading);
  const refresh = useOpenClawStore((s) => s.refreshCronJobs);
  const createJob = useOpenClawStore((s) => s.createCronJob);
  const updateJob = useOpenClawStore((s) => s.updateCronJob);
  const deleteJob = useOpenClawStore((s) => s.deleteCronJob);
  const runNow = useOpenClawStore((s) => s.runCronJobNow);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formSchedule, setFormSchedule] = useState("");
  const [formAgent, setFormAgent] = useState("");
  const [formTask, setFormTask] = useState("");
  const [formEnabled, setFormEnabled] = useState(true);

  useEffect(() => {
    refresh();
  }, []);

  const selected = jobs.find((j) => j.id === selectedId);

  function startCreate() {
    setIsCreating(true);
    setSelectedId(null);
    setFormName("");
    setFormSchedule("0 * * * *");
    setFormAgent("");
    setFormTask("");
    setFormEnabled(true);
  }

  function startEdit(job: CronJob) {
    setIsCreating(false);
    setSelectedId(job.id);
    setFormName(job.name);
    setFormSchedule(job.schedule);
    setFormAgent(job.agent || "");
    setFormTask(job.task);
    setFormEnabled(job.enabled);
  }

  async function handleSave() {
    if (isCreating) {
      await createJob({
        name: formName,
        schedule: formSchedule,
        agent: formAgent || undefined,
        task: formTask,
        enabled: formEnabled
      });
      setIsCreating(false);
    } else if (selectedId) {
      await updateJob(selectedId, {
        name: formName,
        schedule: formSchedule,
        agent: formAgent || undefined,
        task: formTask,
        enabled: formEnabled
      });
    }
  }

  async function handleDelete() {
    if (selectedId) {
      await deleteJob(selectedId);
      setSelectedId(null);
    }
  }

  if (loading && jobs.length === 0) return <EmptyState message="Loading cron jobs..." />;

  return (
    <Flex sx={{ gap: 3, flex: 1, minHeight: 0 }}>
      {/* Job list */}
      <Flex
        sx={{
          flexDirection: "column",
          width: "40%",
          gap: 1,
          overflow: "auto",
          borderRight: "1px solid var(--border)",
          pr: 2
        }}
      >
        <Button
          variant="secondary"
          sx={{ fontSize: 12, mb: 1 }}
          onClick={startCreate}
        >
          + New Cron Job
        </Button>
        {jobs.map((job) => (
          <Flex
            key={job.id}
            onClick={() => startEdit(job)}
            sx={{
              alignItems: "center",
              gap: 2,
              p: 2,
              borderRadius: 6,
              cursor: "pointer",
              bg: selectedId === job.id ? "background-selected" : "transparent",
              "&:hover": { bg: "hover" }
            }}
          >
            <StatusDot color={job.enabled ? "#22c55e" : "#6b7280"} />
            <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
              <Text sx={{ fontSize: 12, fontWeight: "bold" }}>{job.name}</Text>
              <Text
                sx={{ fontSize: 11, fontFamily: "monospace", color: "paragraph-secondary" }}
              >
                {job.schedule}
              </Text>
            </Flex>
            <Button
              variant="secondary"
              sx={{ fontSize: 10, px: 2, py: 1 }}
              onClick={(e) => {
                e.stopPropagation();
                runNow(job.id);
              }}
            >
              Run Now
            </Button>
          </Flex>
        ))}
        {jobs.length === 0 && !isCreating && (
          <EmptyState message="No cron jobs" />
        )}
      </Flex>

      {/* Edit/Create form */}
      <Flex sx={{ flexDirection: "column", flex: 1, gap: 2 }}>
        {isCreating || selectedId ? (
          <>
            <Text sx={{ fontWeight: "bold", fontSize: 14 }}>
              {isCreating ? "New Cron Job" : "Edit Cron Job"}
            </Text>
            <SectionCard>
              <Flex sx={{ flexDirection: "column", gap: 2 }}>
                <FormField label="Name">
                  <Input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    sx={{ fontSize: 12 }}
                  />
                </FormField>
                <FormField label="Schedule (cron)">
                  <Input
                    value={formSchedule}
                    onChange={(e) => setFormSchedule(e.target.value)}
                    sx={{ fontSize: 12, fontFamily: "monospace" }}
                  />
                </FormField>
                <FormField label="Agent (optional)">
                  <Input
                    value={formAgent}
                    onChange={(e) => setFormAgent(e.target.value)}
                    sx={{ fontSize: 12 }}
                  />
                </FormField>
                <FormField label="Task">
                  <Textarea
                    value={formTask}
                    onChange={(e) => setFormTask(e.target.value)}
                    rows={4}
                    sx={{ fontSize: 12, fontFamily: "monospace", resize: "vertical" }}
                  />
                </FormField>
                <Flex sx={{ alignItems: "center", gap: 2 }}>
                  <Text sx={{ fontSize: 12 }}>Enabled</Text>
                  <Button
                    variant="secondary"
                    sx={{ fontSize: 11, px: 2, py: 1 }}
                    onClick={() => setFormEnabled(!formEnabled)}
                  >
                    {formEnabled ? "YES" : "NO"}
                  </Button>
                </Flex>
                <Flex sx={{ gap: 2, mt: 2 }}>
                  <Button variant="accent" sx={{ fontSize: 12 }} onClick={handleSave}>
                    Save
                  </Button>
                  {!isCreating && (
                    <Button
                      variant="error"
                      sx={{ fontSize: 12 }}
                      onClick={handleDelete}
                    >
                      Delete
                    </Button>
                  )}
                </Flex>
              </Flex>
            </SectionCard>
          </>
        ) : (
          <EmptyState message="Select a job or create a new one" />
        )}
      </Flex>
    </Flex>
  );
}

function FormField({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Flex sx={{ flexDirection: "column", gap: 1 }}>
      <Text sx={{ fontSize: 11, fontWeight: "bold", color: "paragraph-secondary" }}>
        {label}
      </Text>
      {children}
    </Flex>
  );
}

// ── Skills Panel ──

function SkillsPanel() {
  const skills = useOpenClawStore((s) => s.skills);
  const loading = useOpenClawStore((s) => s.skillsLoading);
  const refresh = useOpenClawStore((s) => s.refreshSkills);
  const toggleSkill = useOpenClawStore((s) => s.toggleSkill);
  const installSkill = useOpenClawStore((s) => s.installSkill);
  const setApiKey = useOpenClawStore((s) => s.setSkillApiKey);
  const [search, setSearch] = useState("");
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    refresh();
  }, []);

  const filtered = skills.filter(
    (sk) =>
      sk.name.toLowerCase().includes(search.toLowerCase()) ||
      sk.description.toLowerCase().includes(search.toLowerCase()) ||
      sk.tags?.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  if (loading && skills.length === 0) return <EmptyState message="Loading skills..." />;

  return (
    <Flex sx={{ flexDirection: "column", gap: 3 }}>
      <Input
        placeholder="Search skills..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ fontSize: 12 }}
      />
      {filtered.length === 0 ? (
        <EmptyState message="No skills found" />
      ) : (
        <Flex sx={{ flexDirection: "column", gap: 2 }}>
          {filtered.map((skill) => (
            <SectionCard key={skill.id}>
              <Flex sx={{ alignItems: "flex-start", gap: 2 }}>
                <Flex sx={{ flexDirection: "column", flex: 1, gap: 1 }}>
                  <Flex sx={{ alignItems: "center", gap: 2 }}>
                    <Text sx={{ fontWeight: "bold", fontSize: 13 }}>
                      {skill.name}
                    </Text>
                    <Text
                      sx={{
                        fontSize: 10,
                        color: "paragraph-secondary",
                        fontFamily: "monospace"
                      }}
                    >
                      v{skill.version}
                    </Text>
                  </Flex>
                  <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>
                    {skill.description}
                  </Text>
                  {skill.tags && skill.tags.length > 0 && (
                    <Flex sx={{ gap: 1, flexWrap: "wrap", mt: 1 }}>
                      {skill.tags.map((tag) => (
                        <Text
                          key={tag}
                          sx={{
                            fontSize: 10,
                            px: "6px",
                            py: "2px",
                            borderRadius: 4,
                            bg: "background",
                            border: "1px solid var(--border)"
                          }}
                        >
                          {tag}
                        </Text>
                      ))}
                    </Flex>
                  )}
                  {skill.requires_api_key && skill.installed && (
                    <Flex sx={{ gap: 2, mt: 1, alignItems: "center" }}>
                      <Input
                        placeholder="API Key"
                        type="password"
                        value={apiKeyInputs[skill.id] || ""}
                        onChange={(e) =>
                          setApiKeyInputs((prev) => ({
                            ...prev,
                            [skill.id]: e.target.value
                          }))
                        }
                        sx={{ fontSize: 11, flex: 1 }}
                      />
                      <Button
                        variant="secondary"
                        sx={{ fontSize: 10, px: 2, py: 1 }}
                        onClick={() => {
                          if (apiKeyInputs[skill.id]) {
                            setApiKey(skill.id, apiKeyInputs[skill.id]);
                            setApiKeyInputs((prev) => ({ ...prev, [skill.id]: "" }));
                          }
                        }}
                      >
                        Set
                      </Button>
                    </Flex>
                  )}
                </Flex>
                <Flex sx={{ flexDirection: "column", gap: 1, alignItems: "flex-end" }}>
                  {!skill.installed ? (
                    <Button
                      variant="accent"
                      sx={{ fontSize: 11, px: 2, py: 1 }}
                      onClick={() => installSkill(skill.id)}
                    >
                      Install
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      sx={{
                        fontSize: 11,
                        px: 2,
                        py: 1,
                        color: skill.enabled ? "#22c55e" : "#6b7280"
                      }}
                      onClick={() => toggleSkill(skill.id, !skill.enabled)}
                    >
                      {skill.enabled ? "Enabled" : "Disabled"}
                    </Button>
                  )}
                </Flex>
              </Flex>
            </SectionCard>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

// ── Exec Approvals Panel ──

function ExecPanel() {
  const approvals = useOpenClawStore((s) => s.execApprovals);
  const allowlist = useOpenClawStore((s) => s.execAllowlist);
  const loading = useOpenClawStore((s) => s.execLoading);
  const refreshApprovals = useOpenClawStore((s) => s.refreshExecApprovals);
  const updateApproval = useOpenClawStore((s) => s.updateExecApproval);
  const refreshAllowlist = useOpenClawStore((s) => s.refreshExecAllowlist);
  const setAllowlist = useOpenClawStore((s) => s.setExecAllowlist);
  const [allowlistText, setAllowlistText] = useState("");
  const [allowlistDirty, setAllowlistDirty] = useState(false);

  useEffect(() => {
    refreshApprovals();
    refreshAllowlist();
  }, []);

  useEffect(() => {
    setAllowlistText(allowlist.join("\n"));
    setAllowlistDirty(false);
  }, [allowlist]);

  const pending = approvals.filter((a) => a.status === "pending");
  const resolved = approvals.filter((a) => a.status !== "pending");

  return (
    <Flex sx={{ flexDirection: "column", gap: 3, flex: 1 }}>
      {/* Pending Approvals */}
      <Box>
        <Text sx={{ fontWeight: "bold", fontSize: 14, mb: 2 }}>
          Pending Approvals ({pending.length})
        </Text>
        {pending.length === 0 ? (
          <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>
            No pending approvals
          </Text>
        ) : (
          <Flex sx={{ flexDirection: "column", gap: 2 }}>
            {pending.map((approval) => (
              <SectionCard key={approval.id}>
                <Flex sx={{ alignItems: "center", gap: 2 }}>
                  <Flex sx={{ flexDirection: "column", flex: 1, gap: 1 }}>
                    <Text
                      sx={{
                        fontSize: 12,
                        fontFamily: "monospace",
                        bg: "background",
                        px: 2,
                        py: 1,
                        borderRadius: 4,
                        border: "1px solid var(--border)"
                      }}
                    >
                      {approval.command}
                    </Text>
                    <Flex sx={{ gap: 2 }}>
                      {approval.agent && (
                        <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
                          Agent: {approval.agent}
                        </Text>
                      )}
                      <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
                        {formatTime(approval.requested_at)}
                      </Text>
                    </Flex>
                  </Flex>
                  <Flex sx={{ gap: 1 }}>
                    <Button
                      variant="accent"
                      sx={{ fontSize: 11, px: 2, py: 1 }}
                      onClick={() => updateApproval(approval.id, "approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="error"
                      sx={{ fontSize: 11, px: 2, py: 1 }}
                      onClick={() => updateApproval(approval.id, "denied")}
                    >
                      Deny
                    </Button>
                  </Flex>
                </Flex>
              </SectionCard>
            ))}
          </Flex>
        )}
      </Box>

      {/* Allowlist */}
      <Box>
        <Text sx={{ fontWeight: "bold", fontSize: 14, mb: 2 }}>
          Command Allowlist
        </Text>
        <SectionCard>
          <Text sx={{ fontSize: 11, color: "paragraph-secondary", mb: 2 }}>
            One pattern per line. Matching commands are auto-approved.
          </Text>
          <Textarea
            value={allowlistText}
            onChange={(e) => {
              setAllowlistText(e.target.value);
              setAllowlistDirty(true);
            }}
            rows={6}
            sx={{ fontSize: 12, fontFamily: "monospace", resize: "vertical", mb: 2 }}
          />
          <Button
            variant="accent"
            sx={{ fontSize: 12 }}
            disabled={!allowlistDirty}
            onClick={() => {
              const patterns = allowlistText
                .split("\n")
                .map((p) => p.trim())
                .filter(Boolean);
              setAllowlist(patterns);
              setAllowlistDirty(false);
            }}
          >
            Save Allowlist
          </Button>
        </SectionCard>
      </Box>

      {/* Recent resolved */}
      {resolved.length > 0 && (
        <Box>
          <Text sx={{ fontWeight: "bold", fontSize: 14, mb: 2 }}>
            Recently Resolved ({resolved.length})
          </Text>
          <Flex sx={{ flexDirection: "column", gap: 1 }}>
            {resolved.slice(0, 20).map((a) => (
              <Flex
                key={a.id}
                sx={{
                  alignItems: "center",
                  gap: 2,
                  px: 2,
                  py: 1,
                  fontSize: 12,
                  borderRadius: 4,
                  bg: "background-secondary"
                }}
              >
                <Text
                  sx={{
                    fontSize: 10,
                    fontWeight: "bold",
                    color: a.status === "approved" ? "#22c55e" : "#ef4444"
                  }}
                >
                  {a.status.toUpperCase()}
                </Text>
                <Text sx={{ fontFamily: "monospace", flex: 1 }}>{a.command}</Text>
                <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
                  {formatTime(a.requested_at)}
                </Text>
              </Flex>
            ))}
          </Flex>
        </Box>
      )}
    </Flex>
  );
}

// ── Config Panel ──

function ConfigPanel() {
  const configData = useOpenClawStore((s) => s.configData);
  const schema = useOpenClawStore((s) => s.configSchema);
  const loading = useOpenClawStore((s) => s.configLoading);
  const dirty = useOpenClawStore((s) => s.configDirty);
  const loadConfig = useOpenClawStore((s) => s.loadConfig);
  const patchLocal = useOpenClawStore((s) => s.patchConfigLocal);
  const applyConfig = useOpenClawStore((s) => s.applyConfig);
  const revertConfig = useOpenClawStore((s) => s.revertConfig);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (mode === "json") {
      setJsonText(JSON.stringify(configData, null, 2));
      setJsonError(null);
    }
  }, [mode, configData]);

  function handleJsonApply() {
    try {
      const parsed = JSON.parse(jsonText);
      // Replace all top-level keys
      for (const key of Object.keys(parsed)) {
        patchLocal(key, parsed[key]);
      }
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  if (loading && Object.keys(configData).length === 0) {
    return <EmptyState message="Loading config..." />;
  }

  return (
    <Flex sx={{ flexDirection: "column", gap: 3, flex: 1 }}>
      {/* Mode tabs */}
      <Flex sx={{ gap: 1 }}>
        <Button
          variant={mode === "form" ? "accent" : "secondary"}
          sx={{ fontSize: 12, px: 3, py: 1 }}
          onClick={() => setMode("form")}
        >
          Form
        </Button>
        <Button
          variant={mode === "json" ? "accent" : "secondary"}
          sx={{ fontSize: 12, px: 3, py: 1 }}
          onClick={() => setMode("json")}
        >
          Raw JSON
        </Button>
      </Flex>

      {mode === "form" ? (
        <Flex sx={{ flexDirection: "column", gap: 2, overflow: "auto" }}>
          {Object.keys(schema).length > 0 ? (
            Object.entries(schema).map(([key, node]) => (
              <SchemaField
                key={key}
                path={key}
                name={key}
                node={node}
                value={(configData as Record<string, unknown>)[key]}
                onChange={(v) => patchLocal(key, v)}
              />
            ))
          ) : (
            // Fallback: render configData keys
            Object.entries(configData).map(([key, value]) => (
              <SectionCard key={key}>
                <Text sx={{ fontSize: 12, fontWeight: "bold", mb: 1 }}>{key}</Text>
                <Text sx={{ fontSize: 11, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                  {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
                </Text>
              </SectionCard>
            ))
          )}
        </Flex>
      ) : (
        <Flex sx={{ flexDirection: "column", gap: 2 }}>
          <Textarea
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
            }}
            rows={20}
            sx={{ fontSize: 12, fontFamily: "monospace", resize: "vertical" }}
          />
          {jsonError && (
            <Text sx={{ fontSize: 11, color: "#ef4444" }}>{jsonError}</Text>
          )}
          <Button variant="secondary" sx={{ fontSize: 12 }} onClick={handleJsonApply}>
            Parse & Stage
          </Button>
        </Flex>
      )}

      {/* Action bar */}
      <Flex sx={{ gap: 2, borderTop: "1px solid var(--border)", pt: 2 }}>
        <Button variant="secondary" sx={{ fontSize: 12 }} onClick={() => loadConfig()}>
          Reload
        </Button>
        <Button
          variant="accent"
          sx={{ fontSize: 12 }}
          disabled={!dirty}
          onClick={applyConfig}
        >
          Apply Changes
        </Button>
        <Button
          variant="secondary"
          sx={{ fontSize: 12 }}
          disabled={!dirty}
          onClick={revertConfig}
        >
          Revert
        </Button>
        {dirty && (
          <Text sx={{ fontSize: 11, color: "#f59e0b", alignSelf: "center" }}>
            Unsaved changes
          </Text>
        )}
      </Flex>
    </Flex>
  );
}

function SchemaField({
  name,
  path,
  node,
  value,
  onChange
}: {
  name: string;
  path: string;
  node: ConfigSchemaNode;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (node.type) {
    case "string":
      return (
        <FormField label={name}>
          {node.description && (
            <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
              {node.description}
            </Text>
          )}
          {node.enum ? (
            <select
              value={String(value || "")}
              onChange={(e) => onChange(e.target.value)}
              style={{ fontSize: 12, padding: "4px 8px" }}
            >
              {node.enum.map((opt) => (
                <option key={String(opt)} value={String(opt)}>
                  {String(opt)}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={String(value || "")}
              onChange={(e) => onChange(e.target.value)}
              sx={{ fontSize: 12 }}
            />
          )}
        </FormField>
      );
    case "number":
      return (
        <FormField label={name}>
          {node.description && (
            <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
              {node.description}
            </Text>
          )}
          <Input
            type="number"
            value={value !== undefined ? Number(value) : ""}
            onChange={(e) => onChange(Number(e.target.value))}
            sx={{ fontSize: 12 }}
          />
        </FormField>
      );
    case "boolean":
      return (
        <Flex sx={{ alignItems: "center", gap: 2, py: 1 }}>
          <Text sx={{ fontSize: 12, flex: 1 }}>{name}</Text>
          {node.description && (
            <Text sx={{ fontSize: 10, color: "paragraph-secondary", flex: 2 }}>
              {node.description}
            </Text>
          )}
          <Button
            variant="secondary"
            sx={{ fontSize: 11, px: 2, py: 1 }}
            onClick={() => onChange(!value)}
          >
            {value ? "ON" : "OFF"}
          </Button>
        </Flex>
      );
    case "object":
      if (node.properties) {
        return (
          <SectionCard sx={{ ml: 2 }}>
            <Text sx={{ fontSize: 12, fontWeight: "bold", mb: 2 }}>{name}</Text>
            {node.description && (
              <Text sx={{ fontSize: 10, color: "paragraph-secondary", mb: 1 }}>
                {node.description}
              </Text>
            )}
            <Flex sx={{ flexDirection: "column", gap: 2 }}>
              {Object.entries(node.properties).map(([childKey, childNode]) => (
                <SchemaField
                  key={childKey}
                  name={childKey}
                  path={`${path}.${childKey}`}
                  node={childNode}
                  value={
                    value && typeof value === "object"
                      ? (value as Record<string, unknown>)[childKey]
                      : undefined
                  }
                  onChange={(v) => {
                    const obj = value && typeof value === "object"
                      ? { ...(value as Record<string, unknown>) }
                      : {};
                    obj[childKey] = v;
                    onChange(obj);
                  }}
                />
              ))}
            </Flex>
          </SectionCard>
        );
      }
      return (
        <FormField label={name}>
          <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
            {node.description || "Object value"}
          </Text>
          <Textarea
            value={JSON.stringify(value || {}, null, 2)}
            onChange={(e) => {
              try {
                onChange(JSON.parse(e.target.value));
              } catch {
                // ignore parse errors during typing
              }
            }}
            rows={4}
            sx={{ fontSize: 11, fontFamily: "monospace", resize: "vertical" }}
          />
        </FormField>
      );
    case "array":
      return (
        <FormField label={name}>
          <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
            {node.description || "Array value"}
          </Text>
          <Textarea
            value={JSON.stringify(value || [], null, 2)}
            onChange={(e) => {
              try {
                onChange(JSON.parse(e.target.value));
              } catch {
                // ignore parse errors during typing
              }
            }}
            rows={4}
            sx={{ fontSize: 11, fontFamily: "monospace", resize: "vertical" }}
          />
        </FormField>
      );
    default:
      return (
        <Flex sx={{ alignItems: "center", gap: 2, py: 1 }}>
          <Text sx={{ fontSize: 12 }}>{name}</Text>
          <Text
            sx={{
              fontSize: 10,
              px: "6px",
              py: "2px",
              borderRadius: 4,
              bg: "#f59e0b15",
              color: "#f59e0b"
            }}
          >
            unsupported
          </Text>
        </Flex>
      );
  }
}

// ── Token Usage Panel ──

function TokensPanel() {
  const usage = useOpenClawStore((s) => s.tokenUsage);
  const loading = useOpenClawStore((s) => s.tokenUsageLoading);
  const refresh = useOpenClawStore((s) => s.refreshTokenUsage);
  const [timeWindow, setTimeWindow] = useState("24h");

  useEffect(() => {
    refresh(timeWindow);
  }, [timeWindow]);

  const totalTokens = usage.reduce((sum, e) => sum + e.total_tokens, 0);
  const totalCost = usage.reduce((sum, e) => sum + e.cost, 0);

  // Top agent by tokens
  const agentTotals: Record<string, number> = {};
  usage.forEach((e) => {
    const key = e.agent || "unknown";
    agentTotals[key] = (agentTotals[key] || 0) + e.total_tokens;
  });
  const topAgent = Object.entries(agentTotals).sort((a, b) => b[1] - a[1])[0];
  const maxAgentTokens = topAgent ? topAgent[1] : 0;

  if (loading && usage.length === 0) return <EmptyState message="Loading token usage..." />;

  return (
    <Flex sx={{ flexDirection: "column", gap: 3 }}>
      {/* Stats header */}
      <Flex sx={{ gap: 3, flexWrap: "wrap" }}>
        <StatCard label="Total Tokens" value={totalTokens.toLocaleString()} />
        <StatCard label="Total Cost" value={`$${totalCost.toFixed(4)}`} />
        <StatCard
          label="Top Session"
          value={
            usage.length > 0
              ? usage.sort((a, b) => b.total_tokens - a.total_tokens)[0]
                  ?.session_id?.slice(0, 8) || "—"
              : "—"
          }
        />
        <StatCard label="Top Agent" value={topAgent ? topAgent[0] : "—"} />
      </Flex>

      {/* Time window selector */}
      <Flex sx={{ gap: 1 }}>
        {["1h", "24h", "7d", "30d"].map((w) => (
          <Button
            key={w}
            variant={timeWindow === w ? "accent" : "secondary"}
            sx={{ fontSize: 11, px: 2, py: 1 }}
            onClick={() => setTimeWindow(w)}
          >
            {w}
          </Button>
        ))}
      </Flex>

      {/* Agent bar chart */}
      {Object.keys(agentTotals).length > 0 && (
        <SectionCard>
          <Text sx={{ fontSize: 12, fontWeight: "bold", mb: 2 }}>
            Tokens by Agent
          </Text>
          <Flex sx={{ flexDirection: "column", gap: 1 }}>
            {Object.entries(agentTotals)
              .sort((a, b) => b[1] - a[1])
              .map(([agent, tokens]) => (
                <Flex key={agent} sx={{ alignItems: "center", gap: 2 }}>
                  <Text sx={{ fontSize: 11, width: 80, textAlign: "right" }}>
                    {agent}
                  </Text>
                  <Box sx={{ flex: 1, bg: "background", borderRadius: 4, height: 16 }}>
                    <Box
                      sx={{
                        width: `${(tokens / maxAgentTokens) * 100}%`,
                        height: "100%",
                        bg: "#3b82f6",
                        borderRadius: 4,
                        minWidth: 4
                      }}
                    />
                  </Box>
                  <Text sx={{ fontSize: 10, width: 60, color: "paragraph-secondary" }}>
                    {tokens.toLocaleString()}
                  </Text>
                </Flex>
              ))}
          </Flex>
        </SectionCard>
      )}

      {/* Usage table */}
      {usage.length > 0 && (
        <Box sx={{ overflow: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12
            }}
          >
            <thead>
              <tr>
                {["Session", "Agent", "Model", "In", "Out", "Total", "Cost", "Time"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "6px 8px",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 11,
                        fontWeight: "bold",
                        color: "var(--paragraph-secondary)"
                      }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {usage.map((entry, i) => (
                <tr key={i}>
                  <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>
                    {entry.session_id?.slice(0, 8) || "—"}
                  </td>
                  <td style={{ padding: "4px 8px" }}>{entry.agent || "—"}</td>
                  <td style={{ padding: "4px 8px" }}>{entry.model}</td>
                  <td style={{ padding: "4px 8px" }}>
                    {entry.input_tokens.toLocaleString()}
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    {entry.output_tokens.toLocaleString()}
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    {entry.total_tokens.toLocaleString()}
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    ${entry.cost.toFixed(4)}
                  </td>
                  <td style={{ padding: "4px 8px", fontSize: 10 }}>
                    {formatTime(entry.timestamp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}

      {usage.length === 0 && <EmptyState message="No token usage data" />}
    </Flex>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <SectionCard sx={{ flex: "1 1 140px", textAlign: "center" }}>
      <Text sx={{ fontSize: 10, color: "paragraph-secondary", mb: 1 }}>
        {label}
      </Text>
      <Text sx={{ fontSize: 16, fontWeight: "bold" }}>{value}</Text>
    </SectionCard>
  );
}

// ── Presence Panel ──

function PresencePanel() {
  const nodes = useOpenClawStore((s) => s.presenceNodes);
  const loading = useOpenClawStore((s) => s.presenceLoading);
  const refresh = useOpenClawStore((s) => s.refreshPresence);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(() => refresh(), 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const statusColor: Record<string, string> = {
    healthy: "#22c55e",
    degraded: "#f59e0b",
    offline: "#6b7280"
  };

  const roleColor: Record<string, string> = {
    primary: "#3b82f6",
    replica: "#8b5cf6",
    standalone: "#6b7280"
  };

  if (loading && nodes.length === 0) return <EmptyState message="Loading presence..." />;
  if (nodes.length === 0) return <EmptyState message="No gateway nodes detected" />;

  return (
    <Flex sx={{ flexWrap: "wrap", gap: 3 }}>
      {nodes.map((node) => (
        <SectionCard key={node.id} sx={{ minWidth: 240, flex: "1 1 45%" }}>
          <Flex sx={{ alignItems: "center", gap: 2, mb: 2 }}>
            <StatusDot color={statusColor[node.status] || "#6b7280"} />
            <Text sx={{ fontWeight: "bold", fontSize: 14 }}>{node.hostname}</Text>
            <Text
              sx={{
                fontSize: 10,
                px: "6px",
                py: "2px",
                borderRadius: 4,
                bg: `${roleColor[node.role]}15`,
                color: roleColor[node.role],
                fontWeight: "bold",
                textTransform: "uppercase",
                ml: "auto"
              }}
            >
              {node.role}
            </Text>
          </Flex>
          <Flex sx={{ flexDirection: "column", gap: 1 }}>
            <DetailRow label="Version" value={node.version} />
            <DetailRow label="Status" value={node.status} />
            <DetailRow label="Clients" value={String(node.connected_clients)} />
            <DetailRow label="Uptime" value={formatDuration(node.uptime_seconds)} />
          </Flex>
        </SectionCard>
      ))}
    </Flex>
  );
}

// ── Main Control View ──

function ControlView() {
  const [activeTab, setActiveTab] = useState<ControlTab>("channels");
  const connectionState = useOpenClawStore((s) => s.connectionState);

  const connectionColor =
    connectionState === "connected"
      ? "#22c55e"
      : connectionState === "connecting" || connectionState === "authenticating"
      ? "#f59e0b"
      : "#6b7280";

  function renderPanel() {
    switch (activeTab) {
      case "channels":
        return <ChannelsPanel />;
      case "sessions":
        return <SessionsPanel />;
      case "cron":
        return <CronPanel />;
      case "skills":
        return <SkillsPanel />;
      case "exec":
        return <ExecPanel />;
      case "config":
        return <ConfigPanel />;
      case "tokens":
        return <TokensPanel />;
      case "presence":
        return <PresencePanel />;
    }
  }

  return (
    <Flex
      sx={{
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
        bg: "background"
      }}
    >
      {/* Header */}
      <Flex
        sx={{
          alignItems: "center",
          gap: 2,
          px: 3,
          py: 2,
          borderBottom: "1px solid var(--border)"
        }}
      >
        <StatusDot color={connectionColor} />
        <Text sx={{ fontWeight: "bold", fontSize: 16 }}>OpenClaw Control</Text>
        <Text
          sx={{
            fontSize: 11,
            color: "paragraph-secondary",
            ml: "auto"
          }}
        >
          {connectionState}
        </Text>
      </Flex>

      {/* Tab strip */}
      <Flex
        sx={{
          gap: 1,
          px: 3,
          py: 2,
          borderBottom: "1px solid var(--border)",
          overflow: "auto",
          flexShrink: 0
        }}
      >
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "accent" : "secondary"}
            sx={{
              fontSize: 12,
              px: 3,
              py: 1,
              borderRadius: 6,
              whiteSpace: "nowrap"
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </Flex>

      {/* Content */}
      <Flex
        sx={{
          flex: 1,
          overflow: "auto",
          p: 3,
          flexDirection: "column"
        }}
      >
        <DisconnectedGuard>{renderPanel()}</DisconnectedGuard>
      </Flex>
    </Flex>
  );
}

export default ControlView;
