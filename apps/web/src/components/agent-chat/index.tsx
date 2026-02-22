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

import { useEffect } from "react";
import { Button } from "@theme-ui/components";
import { useStore as useOpenClawStore } from "../../stores/openclaw-store";
import { navigate } from "../../navigation";

export function AgentChatFAB() {
  const connectionState = useOpenClawStore((s) => s.connectionState);

  // Global keyboard shortcut: Ctrl+J opens agent chat
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        navigate("/agent-chat");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isConnected = connectionState === "connected";

  return (
    <Button
      onClick={() => navigate("/agent-chat")}
      title="Agent Chat (Ctrl+J)"
      sx={{
        position: "fixed",
        bottom: 16,
        right: 16,
        width: 48,
        height: 48,
        borderRadius: "50%",
        bg: isConnected ? "#22c55e" : "#E00000",
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: isConnected
          ? "0 4px 16px rgba(34,197,94,0.3)"
          : "0 4px 16px rgba(224,0,0,0.3)",
        cursor: "pointer",
        zIndex: 998,
        border: "none",
        fontSize: 22,
        transition: "all 0.2s",
        "&:hover": {
          transform: "scale(1.1)",
          bg: isConnected ? "#16a34a" : "#C00000"
        }
      }}
    >
      <svg
        width="24"
        height="24"
        viewBox="-15 -5 230 224"
        style={{ verticalAlign: "middle" }}
      >
        <polygon
          points="0,0.9 0,35.9 12.8,54.1 81.4,83.2 99.7,107.9 118.3,83.4 186.5,54.7 200,36.1 200,0 186.1,24.2 100.8,49.6 13.9,24.2"
          fill="white"
        />
        <polygon
          points="31.7,65.9 31.7,112.4 58.3,129.7 58.3,159.9 85.5,214 85.7,111.5 43.6,86.6 41.2,73.1"
          fill="white"
        />
        <polygon
          points="168.5,66.2 158.8,73.4 156.1,86.8 114.5,111.3 114.5,214 141.7,160.2 141.7,129.7 168.5,112.4"
          fill="white"
        />
      </svg>
    </Button>
  );
}
