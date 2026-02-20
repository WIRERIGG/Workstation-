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

import { db } from "../common/db";
import AllNotes from "../views/all-notes";
import Notes from "../views/notes";
import { NotebookHeader } from "../components/notebook-header";
import Trash from "../views/trash";
import { useStore as useNoteStore } from "../stores/note-store";
import { useStore as useAppStore } from "../stores/app-store";
import Reminders from "../views/reminders";
import DashboardView from "../views/dashboard";
import AgentsView from "../views/agents";
import TasksView from "../views/tasks";
import CommunicationsView from "../views/communications";
import CalendarView from "../views/calendar";
import SpreadsheetsView from "../views/spreadsheets";
import AgentChatView from "../views/agent-chat";
import TerminalView from "../views/terminal";
import FileExplorerView from "../views/file-explorer";
import GitPanel from "../views/git-panel";
import ConversationsView from "../views/conversations";
import WorkspacesView from "../views/workspaces";
import NewslettersView from "../views/newsletters";
import CallQueueView from "../views/call-queue";
import ControlView from "../views/control";
import { RouteResult, defineRoutes } from "./types";
import { CREATE_BUTTON_MAP } from "../common";
import { strings } from "@notesnook/intl";

function defineRoute(route: RouteResult): RouteResult {
  return route;
}

const NOT_FOUND_ROUTE = defineRoute({
  key: "notFound",
  type: "notFound",
  component: () => <div>Not found</div>
});
const routes = defineRoutes({
  "/notes": () => {
    useNoteStore.getState().setContext();
    return defineRoute({
      key: "home",
      type: "notes",
      title: strings.routes.Notes(),
      component: AllNotes,
      buttons: {
        create: CREATE_BUTTON_MAP.notes,
        search: {
          title: strings.searchANote()
        }
      }
    });
  },
  "/notebooks/:notebookId": async ({ notebookId }) => {
    const notebook = await db.notebooks.notebook(notebookId);
    if (!notebook) return NOT_FOUND_ROUTE;
    const totalNotes = await db.relations.from(notebook, "note").count();
    useNoteStore.getState().setContext({
      type: "notebook",
      id: notebookId,
      item: notebook,
      totalNotes
    });

    return defineRoute({
      key: "notebook",
      type: "notebook",
      component: Notes,
      title: notebook.title,
      props: {
        header: <NotebookHeader notebook={notebook} totalNotes={totalNotes} />
      }
    });
  },
  "/favorites": () => {
    useNoteStore.getState().setContext({ type: "favorite" });
    return defineRoute({
      key: "notes",
      title: strings.routes.Favorites(),
      type: "notes",
      component: Notes
    });
  },
  "/reminders": () => {
    useNoteStore.getState().setContext();
    return defineRoute({
      key: "reminders",
      title: strings.routes.Reminders(),
      type: "reminders",
      component: Reminders,
      buttons: {
        create: CREATE_BUTTON_MAP.reminders
      }
    });
  },
  "/trash": () => {
    useNoteStore.getState().setContext();
    return defineRoute({
      key: "trash",
      type: "trash",
      title: strings.routes.Trash(),
      component: Trash
    });
  },
  "/archive": () => {
    useNoteStore.getState().setContext({ type: "archive" });
    return defineRoute({
      key: "notes",
      title: strings.archive(),
      type: "notes",
      component: Notes
    });
  },
  "/tags/:tagId": async ({ tagId }) => {
    const tag = await db.tags.tag(tagId);
    if (!tag) return NOT_FOUND_ROUTE;
    useNoteStore.getState().setContext({ type: "tag", id: tagId });
    return defineRoute({
      key: "notes",
      type: "notes",
      title: `#${tag.title}`,
      component: Notes
    });
  },
  "/colors/:colorId": async ({ colorId }) => {
    const color = await db.colors.color(colorId);
    if (!color) return NOT_FOUND_ROUTE;
    useNoteStore.getState().setContext({ type: "color", id: colorId });
    return defineRoute({
      key: "notes",
      type: "notes",
      title: color.title,
      component: Notes
    });
  },
  "/monographs": () => {
    useNoteStore.getState().setContext({ type: "monographs" });
    return defineRoute({
      key: "notes",
      title: strings.routes.Monographs(),
      type: "notes",
      component: Notes
    });
  },
  "/dashboard": () => {
    return defineRoute({
      key: "dashboard",
      title: "Dashboard",
      type: "placeholder",
      component: DashboardView
    });
  },
  "/tasks": () => {
    return defineRoute({
      key: "tasks",
      title: "Tasks",
      type: "placeholder",
      component: TasksView
    });
  },
  "/calendar": () => {
    return defineRoute({
      key: "calendar",
      title: "Calendar",
      type: "placeholder",
      component: CalendarView
    });
  },
  "/agents": () => {
    return defineRoute({
      key: "agents",
      title: "Agents",
      type: "placeholder",
      component: AgentsView
    });
  },
  "/spreadsheets": () => {
    return defineRoute({
      key: "spreadsheets",
      title: "Spreadsheets",
      type: "placeholder",
      component: SpreadsheetsView
    });
  },
  "/communications": () => {
    return defineRoute({
      key: "communications",
      title: "Communications",
      type: "placeholder",
      component: CommunicationsView
    });
  },
  "/agent-chat": () => {
    return defineRoute({
      key: "agent-chat",
      title: "Agent Chat",
      type: "placeholder",
      component: AgentChatView
    });
  },
  "/terminal": () => {
    return defineRoute({
      key: "terminal",
      title: "Terminal",
      type: "placeholder",
      component: TerminalView
    });
  },
  "/files": () => {
    return defineRoute({
      key: "files",
      title: "Files",
      type: "placeholder",
      component: FileExplorerView
    });
  },
  "/newsletters": () => {
    return defineRoute({
      key: "newsletters",
      title: "Newsletters",
      type: "placeholder",
      component: NewslettersView
    });
  },
  "/call-queue": () => {
    return defineRoute({
      key: "call-queue",
      title: "Call Queue",
      type: "placeholder",
      component: CallQueueView
    });
  },
  "/control": () => {
    return defineRoute({
      key: "control",
      title: "Control Panel",
      type: "placeholder",
      component: ControlView
    });
  },
  "/git": () => {
    return defineRoute({
      key: "git",
      title: "Git",
      type: "placeholder",
      component: GitPanel
    });
  },
  "/conversations": () => {
    return defineRoute({
      key: "conversations",
      title: "Conversations",
      type: "placeholder",
      component: ConversationsView
    });
  },
  "/workspaces": () => {
    return defineRoute({
      key: "workspaces",
      title: "Workspaces",
      type: "placeholder",
      component: WorkspacesView
    });
  }
});

export default routes;
export type Route = keyof typeof routes;
