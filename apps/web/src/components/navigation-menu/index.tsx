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

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Flex, Image, Text } from "@theme-ui/components";
import {
  Note,
  StarOutline,
  Monographs,
  Trash,
  Settings,
  Notebook2,
  Tag2,
  Topic,
  DarkMode,
  LightMode,
  Login,
  Circle,
  Icon,
  Reminders,
  User,
  Pro,
  Documentation,
  Logout,
  Reset,
  Rename,
  ExpandSidebar,
  HamburgerMenu,
  Archive,
  Home,
  Notebook as NotebookIcon,
  Plus,
  SortBy,
  Tag as TagIcon,
  Dashboard,
  Tasks,
  Calendar,
  Robot,
  Table,
  MessageText,
  Support,
  ConsoleLine,
  File,
  Newspaper,
  PhoneInTalk,
  Radar,
  GitBranch,
  Forum,
  CardMultiple
} from "../icons";
import { SortableNavigationItem } from "./navigation-item";
import {
  getCurrentPath,
  hardNavigate,
  hashNavigate,
  navigate,
  NavigationEvents
} from "../../navigation";
import { db } from "../../common/db";
import { isMobile } from "../../hooks/use-mobile";
import { useStore as useAppStore } from "../../stores/app-store";
import { useStore as useUserStore } from "../../stores/user-store";
import { useStore as useThemeStore } from "../../stores/theme-store";
import { useStore as useSettingStore } from "../../stores/setting-store";
import { useStore as useNoteStore } from "../../stores/note-store";
import { useStore as useReminderStore } from "../../stores/reminder-store";
import { useStore as useMonographStore } from "../../stores/monograph-store";
import { useStore as useTrashStore } from "../../stores/trash-store";
import { useStore as useAgentStore } from "../../stores/agent-store";
import { useStore as useTaskStore } from "../../stores/task-store";
import { useStore as useCommsStore } from "../../stores/comms-store";
import { useStore as useSearchStore } from "../../stores/search-store";
import { useStore as useBrandingStore } from "../../stores/branding-store";
import useLocation from "../../hooks/use-location";
import { FlexScrollContainer } from "../scroll-container";
import { ScopedThemeProvider } from "../theme-provider";
import {
  closestCenter,
  DndContext,
  useSensor,
  useSensors,
  KeyboardSensor,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { usePersistentState } from "../../hooks/use-persistent-state";
import { MenuItem } from "@workstation/ui";
import { Color, Notebook, Tag } from "@workstation/core";
import { handleDrop } from "../../common/drop-handler";
import { Menu } from "../../hooks/use-menu";
import { RenameColorDialog } from "../../dialogs/item-dialog";
import { strings } from "@workstation/intl";
import Tags from "../../views/tags";
import { Notebooks } from "../../views/notebooks";
import { UserProfile } from "../../dialogs/settings/components/user-profile";
import {
  checkFeature,
  createSetDefaultHomepageMenuItem,
  logout,
  withFeatureCheck
} from "../../common";
import { TabItem } from "./tab-item";
import { Freeze } from "react-freeze";
import { CREATE_BUTTON_MAP } from "../../common";
import { useStore as useNotebookStore } from "../../stores/notebook-store";
import { useStore as useTagStore } from "../../stores/tag-store";
import { showSortMenu } from "../group-header";
import { BuyDialog } from "../../dialogs/buy-dialog";
import {
  FeatureResult,
  isFeatureAvailable,
  useIsFeatureAvailable
} from "@workstation/common";
import { isUserSubscribed } from "../../hooks/use-is-user-premium";
import { shouldShowWrapped } from "../../utils/should-show-wrapped";

type Route = {
  id: string;
  title: string;
  path: string;
  icon: Icon;
  tag?: string;
  loginRequired?: boolean;
  section?: "workspace" | "tools" | "developer" | "organize";
};

const routes: Route[] = [
  // ── WORKSPACE ──
  {
    id: "dashboard",
    title: "Dashboard",
    path: "/dashboard",
    icon: Dashboard,
    section: "workspace"
  },
  {
    id: "control",
    title: "Control",
    path: "/control",
    icon: Radar,
    section: "workspace"
  },
  {
    id: "notes",
    title: strings.routes.Notes(),
    path: "/notes",
    icon: Note,
    section: "workspace"
  },
  {
    id: "tasks",
    title: "Tasks",
    path: "/tasks",
    icon: Tasks,
    section: "workspace"
  },
  {
    id: "calendar",
    title: "Calendar",
    path: "/calendar",
    icon: Calendar,
    section: "workspace"
  },
  {
    id: "agent-chat",
    title: "Agent Chat",
    path: "/agent-chat",
    icon: Support,
    section: "workspace"
  },
  {
    id: "terminal",
    title: "Terminal",
    path: "/terminal",
    icon: ConsoleLine,
    section: "workspace"
  },
  {
    id: "files",
    title: "Files",
    path: "/files",
    icon: File,
    section: "workspace"
  },

  // ── TOOLS ──
  {
    id: "agents",
    title: "Agents",
    path: "/agents",
    icon: Robot,
    section: "tools"
  },
  {
    id: "spreadsheets",
    title: "Spreadsheets",
    path: "/spreadsheets",
    icon: Table,
    section: "tools"
  },
  {
    id: "communications",
    title: "Communications",
    path: "/communications",
    icon: MessageText,
    section: "tools"
  },
  {
    id: "newsletters",
    title: "Newsletters",
    path: "/newsletters",
    icon: Newspaper,
    section: "tools"
  },
  {
    id: "call-queue",
    title: "Call Queue",
    path: "/call-queue",
    icon: PhoneInTalk,
    section: "tools"
  },

  // ── DEVELOPER ──
  {
    id: "git",
    title: "Git",
    path: "/git",
    icon: GitBranch,
    section: "developer"
  },
  {
    id: "conversations",
    title: "Conversations",
    path: "/conversations",
    icon: Forum,
    section: "developer"
  },
  {
    id: "workspaces",
    title: "Workspaces",
    path: "/workspaces",
    icon: CardMultiple,
    section: "developer"
  },

  // ── ORGANIZE ──
  {
    id: "favorites",
    title: strings.routes.Favorites(),
    path: "/favorites",
    icon: StarOutline,
    section: "organize"
  },
  {
    id: "archive",
    title: strings.archive(),
    path: "/archive",
    icon: Archive,
    section: "organize"
  },
  {
    id: "trash",
    title: strings.routes.Trash(),
    path: "/trash",
    icon: Trash,
    section: "organize"
  }
];

const settings = {
  id: "settings",
  title: strings.routes.Settings(),
  path: "/settings",
  icon: Settings
} as const;

export type NavigationTabItem = {
  id: "home" | "notebooks" | "tags";
  icon: Icon;
  title: string;
  actions: {
    id: string;
    title: string;
    icon: Icon;
    onClick: () => void;
  }[];
};

const tabs: NavigationTabItem[] = [
  {
    id: "home",
    icon: Home,
    title: strings.routes.Home(),
    actions: []
  },
  {
    id: "notebooks",
    icon: NotebookIcon,
    title: strings.routes.Notebooks(),
    actions: [
      {
        id: "create-notebook-button",
        title: CREATE_BUTTON_MAP.notebooks.title,
        icon: Plus,
        onClick: CREATE_BUTTON_MAP.notebooks.onClick
      },
      {
        id: "notebooks-sort-button",
        title: strings.sortBy(),
        icon: SortBy,
        onClick: () =>
          showSortMenu("notebooks", () => useNotebookStore.getState().refresh())
      }
    ]
  },
  {
    id: "tags",
    icon: TagIcon,
    title: strings.routes.Tags(),
    actions: [
      {
        id: "create-tag-button",
        title: CREATE_BUTTON_MAP.tags.title,
        icon: Plus,
        onClick: CREATE_BUTTON_MAP.tags.onClick
      },
      {
        id: "tags-sort-button",
        title: strings.sortBy(),
        icon: SortBy,
        onClick: () =>
          showSortMenu("tags", () => useTagStore.getState().refresh())
      }
    ]
  }
] as const;

function NavigationMenu({ onExpand }: { onExpand?: () => void }) {
  const isFocusMode = useAppStore((store) => store.isFocusMode);
  const navigationTab = useAppStore((store) => store.navigationTab);
  const setNavigationTab = useAppStore((store) => store.setNavigationTab);
  const isNavPaneCollapsed = useAppStore((store) => store.isNavPaneCollapsed);
  const branding = useBrandingStore((s) => s.branding);
  const [expanded, setExpanded] = useState(false);
  const isCollapsed = isNavPaneCollapsed && !expanded;
  const mouseHoverTimeout = useRef(0);
  const currentTab = tabs.find((tab) => tab.id === navigationTab) || tabs[0];
  const displayName = branding.isOnboarded && branding.businessName
    ? `${branding.businessName} Desk`
    : "Workstation";

  useEffect(() => {
    if (isNavPaneCollapsed) setExpanded(false);
  }, [isNavPaneCollapsed]);

  useEffect(() => {
    function onNavigate() {
      // collapse navigation menu on navigate e.g. when navigating to a notebook
      // or a tag
      if (!useAppStore.getState().isNavPaneCollapsed) return;
      setExpanded(false);
    }
    const event = NavigationEvents.subscribe("onNavigate", onNavigate);
    return () => {
      event.unsubscribe();
    };
  }, []);

  return (
    <ScopedThemeProvider
      scope="navigationMenu"
      sx={{
        display: isFocusMode ? "none" : "flex",
        zIndex: 1,
        position: "relative",
        flex: 1,
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        bg: "background",
        borderRight: "1px solid var(--separator)",
        pt: 1,
        transition: "width 0.1s ease-in",
        width: isNavPaneCollapsed ? (expanded ? 250 : 50) : "100%"
      }}
      onMouseEnter={() => {
        clearTimeout(mouseHoverTimeout.current);
      }}
      onMouseLeave={() => {
        clearTimeout(mouseHoverTimeout.current);
        if (!isNavPaneCollapsed) return;
        mouseHoverTimeout.current = setTimeout(() => {
          if (!isNavPaneCollapsed) return;
          setExpanded(false);
        }, 500) as unknown as number;
      }}
    >
      {isCollapsed ? (
        <Button
          variant="secondary"
          sx={{ p: 1, px: "small", bg: "transparent", mx: 1 }}
          onClick={() => setExpanded(true)}
        >
          <HamburgerMenu size={16} color="icon" />
        </Button>
      ) : (
        <Flex
          sx={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            mx: 1
          }}
        >
          <Flex
            className="navigation-menu-header"
            sx={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 1
            }}
          >
            <svg
              style={{
                width: 22,
                height: 22
              }}
              viewBox="-15 -5 230 224"
              xmlns="http://www.w3.org/2000/svg"
            >
              <polygon points="0,0.9 0,35.9 12.8,54.1 81.4,83.2 99.7,107.9 118.3,83.4 186.5,54.7 200,36.1 200,0 186.1,24.2 100.8,49.6 13.9,24.2" fill={branding.primaryColor}/>
              <polygon points="31.7,65.9 31.7,112.4 58.3,129.7 58.3,159.9 85.5,214 85.7,111.5 43.6,86.6 41.2,73.1" fill={branding.primaryColor}/>
              <polygon points="168.5,66.2 158.8,73.4 156.1,86.8 114.5,111.3 114.5,214 141.7,160.2 141.7,129.7 168.5,112.4" fill={branding.primaryColor}/>
            </svg>

            <Text
              variant="heading"
              sx={{
                fontSize: 15,
                fontWeight: "bold",
                display: "block",
                letterSpacing: "0.5px"
              }}
            >
              {displayName}
            </Text>
          </Flex>
          <Flex sx={{ gap: "small", alignItems: "center" }}>
            {isNavPaneCollapsed ? (
              <Button
                variant="secondary"
                sx={{ p: 1, bg: "transparent" }}
                onClick={onExpand}
                title={strings.expandSidebar()}
              >
                <ExpandSidebar size={13} color="icon" />
              </Button>
            ) : null}
            <NavigationDropdown />
          </Flex>
        </Flex>
      )}
      <Flex
        sx={{
          justifyContent: isCollapsed ? "center" : "space-between",
          alignItems: "center",
          borderTop: "1px solid var(--separator)",
          borderBottom: "1px solid var(--separator)",
          mt: 1,
          mb: 1,
          px: 1,
          py: 1
        }}
      >
        <Flex
          sx={{
            flexDirection: isCollapsed ? "column" : "row",
            alignItems: isCollapsed ? "stretch" : "center",
            gap: "small",
            flex: 1
          }}
        >
          {tabs.map((tab) => (
            <TabItem
              key={tab.id}
              data-test-id={`tab-${tab.id}`}
              title={tab.title}
              icon={tab.icon}
              selected={currentTab.id === tab.id}
              onClick={() => {
                if (isNavPaneCollapsed) setExpanded(true);
                setNavigationTab(tab.id);
              }}
            />
          ))}
        </Flex>
        {!isCollapsed && currentTab.actions.length > 0 ? (
          <Flex sx={{ alignItems: "center" }}>
            {currentTab.actions.map((action) => (
              <Button
                key={action.id}
                variant="secondary"
                sx={{ p: 1, bg: "transparent" }}
                onClick={action.onClick}
                title={action.title}
                data-test-id={action.id}
              >
                <action.icon size={13} color="icon" />
              </Button>
            ))}
          </Flex>
        ) : null}
      </Flex>

      <Flex
        id="navigation-menu"
        data-test-id="navigation-menu"
        sx={{
          flex: 1,
          overflow: "hidden",
          flexDirection: "column",
          justifyContent: "space-between"
        }}
        onContextMenu={async (e) => {
          e.preventDefault();
          Menu.openMenu(await getSidebarItemsAsMenuItems());
        }}
      >
        <Freeze freeze={isCollapsed || currentTab.id !== "notebooks"}>
          <Notebooks />
        </Freeze>
        <Freeze freeze={isCollapsed || currentTab.id !== "tags"}>
          <Tags />
        </Freeze>
        <Freeze freeze={currentTab.id !== "home" && !isCollapsed}>
          <FlexScrollContainer
            style={{
              flexDirection: "column",
              display: "flex"
            }}
            trackStyle={() => ({
              width: 3
            })}
            thumbStyle={() => ({ width: 3 })}
            suppressScrollX={true}
          >
            <Flex sx={{ flexDirection: "column", px: 1, gap: [1, 1, "small"] }}>
              <Routes
                isCollapsed={isCollapsed}
                collapse={() => isNavPaneCollapsed && setExpanded(false)}
              />
              <Colors
                isCollapsed={isCollapsed}
                collapse={() => isNavPaneCollapsed && setExpanded(false)}
              />
              <Box
                bg="separator"
                my={1}
                sx={{ width: "100%", height: "0.8px", alignSelf: "center" }}
              />
              <Shortcuts
                isCollapsed={isCollapsed}
                collapse={() => isNavPaneCollapsed && setExpanded(false)}
              />
            </Flex>
          </FlexScrollContainer>
        </Freeze>
      </Flex>
      {currentTab.id === "home" && !isCollapsed && shouldShowWrapped() ? (
        <Button
          variant="accent"
          sx={{ m: 2 }}
          onClick={() => {
            hardNavigate("/wrapped");
          }}
        >
          🎉 Wrapped {new Date().getFullYear()}
        </Button>
      ) : null}
    </ScopedThemeProvider>
  );
}
export default React.memo(NavigationMenu);

function SectionHeader({ title, isCollapsed }: { title: string; isCollapsed: boolean }) {
  if (isCollapsed) return null;
  return (
    <Text
      sx={{
        fontSize: "10px",
        fontWeight: "bold",
        color: "paragraph-secondary",
        textTransform: "uppercase",
        letterSpacing: "1.2px",
        px: 1,
        pt: 2,
        pb: "2px",
        userSelect: "none"
      }}
    >
      {title}
    </Text>
  );
}

const SECTIONS = ["workspace", "tools", "developer", "organize"] as const;
const SECTION_LABELS: Record<string, string> = {
  workspace: "Workspace",
  tools: "Tools",
  developer: "Developer",
  organize: "Organize"
};

function Routes({
  isCollapsed,
  collapse
}: {
  isCollapsed: boolean;
  collapse: () => void;
}) {
  const customizableSidebar = useIsFeatureAvailable("customizableSidebar");
  const hiddenRoutes = useAppStore((store) => store.hiddenRoutes);
  const isLoggedIn = useUserStore((store) => store.isLoggedIn);

  const filteredRoutes = routes
    .filter(
      customizableSidebar?.isAllowed
        ? (r) => !hiddenRoutes.includes(r.id)
        : () => true
    )
    .filter((r) => (r.loginRequired ? isLoggedIn : true))
    .filter((r) => (r.section === "developer" ? IS_DESKTOP_APP : true));

  return (
    <>
      {SECTIONS.map((section) => {
        const sectionRoutes = filteredRoutes.filter(
          (r) => r.section === section
        );
        if (sectionRoutes.length === 0) return null;
        return (
          <React.Fragment key={section}>
            <SectionHeader
              title={SECTION_LABELS[section]}
              isCollapsed={isCollapsed}
            />
            <ReorderableList
              items={sectionRoutes}
              orderKey={`sidebarOrder:routes:${section}`}
              order={() => db.settings.getSideBarOrder("routes")}
              onOrderChanged={(order) =>
                db.settings.setSideBarOrder("routes", order)
              }
              context={{ isCollapsed, collapse }}
              renderItem={RouteItem}
            />
          </React.Fragment>
        );
      })}
    </>
  );
}

function RouteItem({
  item,
  context
}: {
  item: Route;
  context?: { isCollapsed: boolean; collapse: () => void };
}) {
  const [location] = useLocation();

  return (
    <SortableNavigationItem
      key={item.id}
      id={item.id}
      title={item.title}
      icon={item.icon}
      isCollapsed={context?.isCollapsed}
      onDrop={async (e) => {
        await handleDrop(e.dataTransfer, {
          type:
            item.path === "/trash"
              ? "trash"
              : item.path === "/favorites"
              ? "favorites"
              : item.path == "/archive"
              ? "archive"
              : undefined
        });
      }}
      selected={
        item.path === "/"
          ? location === item.path
          : location.startsWith(item.path)
      }
      onClick={() => {
        navigateToRoute(item.path);
        context?.collapse();
      }}
      menuItems={[
        {
          type: "lazy-loader",
          key: "sidebar-items-loader",
          items: async () => [
            createSetDefaultHomepageMenuItem(
              item.id,
              "route",
              await isFeatureAvailable("customHomepage")
            )
          ]
        },
        {
          type: "separator",
          key: "sep32"
        },
        {
          type: "lazy-loader",
          key: "sidebar-items-loader",
          items: getSidebarItemsAsMenuItems
        }
      ]}
    >
      <ItemCount item={item} />
    </SortableNavigationItem>
  );
}

function Colors({
  isCollapsed,
  collapse
}: {
  isCollapsed: boolean;
  collapse: () => void;
}) {
  const customizableSidebar = useIsFeatureAvailable("customizableSidebar");
  const colors = useAppStore((store) => store.colors);
  const hiddenColors = useAppStore((store) => store.hiddenColors);

  return (
    <ReorderableList
      items={
        customizableSidebar?.isAllowed
          ? colors.filter((c) => !hiddenColors.includes(c.id))
          : colors
      }
      orderKey={`sidebarOrder:colors`}
      order={() => db.settings.getSideBarOrder("colors")}
      onOrderChanged={(order) => db.settings.setSideBarOrder("colors", order)}
      renderItem={ColorItem}
      context={{ collapse, isCollapsed }}
    />
  );
}

function ColorItem({
  item: color,
  context
}: {
  item: Color;
  context?: { isCollapsed: boolean; collapse: () => void };
}) {
  const currentContext = useNoteStore((store) =>
    store.context?.type === "color" ? store.context : null
  );
  return (
    <SortableNavigationItem
      id={color.id}
      key={color.id}
      title={color.title}
      isCollapsed={context?.isCollapsed}
      icon={Circle}
      selected={currentContext?.id === color.id}
      color={color.colorCode}
      onClick={() => {
        navigateToRoute(`/colors/${color.id}`);
        context?.collapse();
      }}
      onDrop={(e) => handleDrop(e.dataTransfer, color)}
      menuItems={[
        {
          type: "button",
          key: "rename-color",
          title: strings.renameColor(),
          onClick: () => RenameColorDialog.show(color),
          icon: Rename.path
        },
        {
          type: "button",
          key: "remove-color",
          title: strings.removeColor(),
          onClick: async () => {
            await db.colors.remove(color.id);
            await useAppStore.getState().refreshNavItems();
          },
          icon: Trash.path
        },
        {
          type: "lazy-loader",
          key: "sidebar-items-loader",
          items: async () => [
            createSetDefaultHomepageMenuItem(
              color.id,
              color.type,
              await isFeatureAvailable("customHomepage")
            )
          ]
        },
        {
          type: "separator",
          key: "sep32"
        },
        {
          type: "lazy-loader",
          key: "sidebar-items-loader",
          items: getSidebarItemsAsMenuItems
        }
      ]}
    >
      <ItemCount item={color} />
    </SortableNavigationItem>
  );
}

function Shortcuts({
  isCollapsed,
  collapse
}: {
  isCollapsed: boolean;
  collapse: () => void;
}) {
  const shortcuts = useAppStore((store) => store.shortcuts);

  return (
    <ReorderableList
      items={shortcuts}
      orderKey={`sidebarOrder:shortcuts`}
      order={() => db.settings.getSideBarOrder("shortcuts")}
      onOrderChanged={(order) =>
        db.settings.setSideBarOrder("shortcuts", order)
      }
      context={{ isCollapsed, collapse }}
      renderItem={ShortcutItem}
    />
  );
}

function ShortcutItem({
  item,
  context
}: {
  item: Notebook | Tag;
  context?: { isCollapsed: boolean; collapse: () => void };
}) {
  const currentContext = useNoteStore((store) =>
    store.context?.type === "tag" || store.context?.type === "notebook"
      ? store.context
      : null
  );

  return (
    <SortableNavigationItem
      id={item.id}
      key={item.id}
      title={item.title}
      isCollapsed={context?.isCollapsed}
      menuItems={[
        {
          type: "lazy-loader",
          key: "sidebar-items-loader",
          items: async () => [
            createSetDefaultHomepageMenuItem(
              item.id,
              item.type,
              await isFeatureAvailable("customHomepage")
            )
          ]
        },
        {
          type: "separator",
          key: "sep32"
        },
        {
          type: "button",
          key: "removeshortcut",
          title: strings.doActions.remove.shortcut(1),
          icon: Trash.path,
          onClick: async () => {
            await db.shortcuts.remove(item.id);
            useAppStore.getState().refreshNavItems();
          }
        }
      ]}
      icon={
        item.type === "notebook"
          ? Notebook2
          : item.type === "tag"
          ? Tag2
          : Topic
      }
      selected={currentContext?.id === item.id}
      onDrop={(e) => handleDrop(e.dataTransfer, item)}
      onClick={async () => {
        navigateToRoute(
          item.type === "notebook"
            ? `/notebooks/${item.id}`
            : `/tags/${item.id}`
        );
        context?.collapse();
      }}
    >
      <ItemCount item={item} />
    </SortableNavigationItem>
  );
}

function ItemCount({ item }: { item: Route | Color | Notebook | Tag }) {
  const notes = useNoteStore((store) => store.notes);
  const reminders = useReminderStore((store) => store.reminders);
  const trash = useTrashStore((store) => store.trash);
  const monographs = useMonographStore((store) => store.monographs);
  const agents = useAgentStore((store) => store.agents);
  const tasks = useTaskStore((store) => store.tasks);
  const messages = useCommsStore((store) => store.messages);
  const [count, setCount] = useState(0);

  useEffect(() => {
    (async function () {
      if ("type" in item) {
        if (item.type === "color") return db.colors.count(item.id);
        else if (item.type === "notebook" || item.type === "tag")
          return db.relations.from(item, "note").count();
      } else {
        switch (item.id) {
          case "notes":
            return notes?.length || 0;
          case "favorites":
            return db.notes.favorites.count();
          case "reminders":
            return reminders?.length || 0;
          case "trash":
            return trash?.length || 0;
          case "monographs":
            return monographs?.length || 0;
          case "archive":
            return db.notes.archived.count();
          case "agents":
            return agents.filter((a) => a.status === "running").length;
          case "tasks":
            return tasks.filter((t) => t.status === "todo" || t.status === "in_progress").length;
          case "communications":
            return messages.filter((m) => !m.isRead).length;
          default:
            return 0;
        }
      }
    })().then((c) => setCount(c || 0));
  }, [item, notes, trash, monographs, reminders, agents, tasks, messages]);

  // Show badge-style count for unread comms
  if ("id" in item && item.id === "communications") {
    const unread = messages.filter((m) => !m.isRead).length;
    if (unread > 0) {
      return (
        <Text
          sx={{
            fontSize: 10,
            fontWeight: "bold",
            bg: "#ef4444",
            color: "white",
            borderRadius: 10,
            px: "5px",
            py: "1px",
            minWidth: 18,
            textAlign: "center"
          }}
        >
          {unread}
        </Text>
      );
    }
  }

  return <Text variant="subBody">{count}</Text>;
}

function NavigationDropdown() {
  const user = useUserStore((store) => store.user);
  const profile = useSettingStore((store) => store.profile);
  const theme = useThemeStore((store) => store.colorScheme);
  const toggleNightMode = useThemeStore((store) => store.toggleColorScheme);
  const setFollowSystemTheme = useThemeStore(
    (store) => store.setFollowSystemTheme
  );

  const isSubscribed = useMemo(() => isUserSubscribed(user), [user]);

  const notLoggedIn = Boolean(!user || !user.id);

  return (
    <Button
      variant="secondary"
      onClick={(e) => {
        e.preventDefault();
        Menu.openMenu(
          [
            {
              type: "popup",
              component: () => <UserProfile minimal />,
              key: "profile"
            },
            {
              type: "separator",
              key: "sep"
            },
            {
              type: "button",
              title: strings.toggleDarkLightMode(),
              key: "toggle-theme-mode",
              icon: theme === "dark" ? LightMode.path : DarkMode.path,
              onClick: () => {
                setFollowSystemTheme(false);
                toggleNightMode();
              }
            },
            {
              type: "button",
              title: strings.upgradeToPro(),
              icon: Pro.path,
              key: "upgrade",
              onClick: () => BuyDialog.show({}),
              isHidden: notLoggedIn || isSubscribed
            },
            {
              type: "button",
              title: settings.title,
              key: settings.id,
              icon: settings.icon.path,
              onClick: () => {
                hashNavigate(settings.path);
              }
            },
            {
              type: "button",
              title: strings.helpAndSupport(),
              icon: Documentation.path,
              key: "help-and-support",
              onClick: () => {
                window.open("https://help.workstation.com/", "_blank");
              }
            },
            {
              type: "button",
              title: strings.login(),
              icon: Login.path,
              key: "login",
              isHidden: !notLoggedIn,
              onClick: () => hardNavigate("/login")
            },
            {
              type: "button",
              title: strings.logout(),
              icon: Logout.path,
              key: "logout",
              isHidden: notLoggedIn,
              onClick: () => logout()
            }
          ],
          {
            position: {
              target: e.currentTarget,
              location: "below",
              yOffset: 5
            }
          }
        );
      }}
      data-test-id="profile-dropdown"
      sx={{
        bg: "background-secondary",
        size: 26,
        borderRadius: 80,
        cursor: "pointer",
        position: "relative",
        border: "1px solid var(--border)",
        alignItems: "center",
        p: 0
      }}
    >
      {!user || !user.id || !profile?.profilePicture ? (
        <User size={14} color="icon" />
      ) : (
        <Image
          sx={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            borderRadius: 80
          }}
          src={profile.profilePicture}
        />
      )}
    </Button>
  );
}

type ReorderableListProps<T> = {
  orderKey: string;
  items: T[];
  context?: any;
  renderItem: (props: { item: T; context?: any }) => JSX.Element;
  onOrderChanged: (newOrder: string[]) => void;
  order: () => string[];
};

function ReorderableList<T extends { id: string }>(
  props: ReorderableListProps<T>
) {
  const {
    orderKey,
    items,
    renderItem: Item,
    onOrderChanged,
    context,
    order: _order
  } = props;
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );
  const [activeItem, setActiveItem] = useState<T>();
  const [order, setOrder] = usePersistentState<string[]>(orderKey, _order());
  const customizableSidebar = useIsFeatureAvailable("customizableSidebar");
  const orderedItems = customizableSidebar?.isAllowed
    ? orderItems(items, order)
    : items;

  useEffect(() => {
    setOrder(_order());
  }, [_order]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      cancelDrop={async () => {
        return (
          !customizableSidebar || !(await checkFeature(customizableSidebar))
        );
      }}
      onDragStart={(event) => {
        setActiveItem(orderedItems.find((i) => i.id === event.active.id));
      }}
      onDragEnd={(event) => {
        const { active, over } = event;

        const overId = over?.id as string;
        if (overId && active.id !== overId) {
          const transitionOrder =
            order.length === 0 || order.length !== orderedItems.length
              ? orderedItems.map((i) => i.id)
              : order;
          const newIndex = transitionOrder.indexOf(overId);
          const oldIndex = transitionOrder.indexOf(active.id as string);
          const newOrder = arrayMove(transitionOrder, oldIndex, newIndex);
          setOrder(newOrder);
          onOrderChanged(newOrder);
        }
        setActiveItem(undefined);
      }}
      measuring={{
        droppable: { strategy: MeasuringStrategy.Always }
      }}
    >
      <SortableContext
        items={orderedItems}
        strategy={verticalListSortingStrategy}
      >
        {orderedItems.map((item) => (
          <Item key={item.id} item={item} context={context} />
        ))}

        <DragOverlay
          dropAnimation={{
            duration: 500,
            easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)"
          }}
        >
          {activeItem && <Item item={activeItem} context={context} />}
        </DragOverlay>
      </SortableContext>
    </DndContext>
  );
}

function orderItems<T extends { id: string }>(items: T[], order: string[]) {
  const sorted: T[] = [];
  order.forEach((id) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    sorted.push(item);
  });
  sorted.push(...items.filter((i) => !order.includes(i.id)));
  return sorted;
}

function toMenuItems<T extends { id: string; title: string }>(
  items: T[],
  hiddenIds: string[],
  onHiddenIdsUpdated: (ids: string[]) => void,
  customizableSidebar: FeatureResult<"customizableSidebar">,
  extraProps?: (item: T) => Partial<MenuItem>
): MenuItem[] {
  return items.map((item) => ({
    ...extraProps?.(item),
    type: "button",
    key: item.id,
    title: item.title,
    isChecked: !hiddenIds.includes(item.id),
    premium: !customizableSidebar.isAllowed,
    onClick: withFeatureCheck(customizableSidebar, async () => {
      const copy = hiddenIds.slice();
      const index = copy.indexOf(item.id);
      if (index > -1) copy.splice(index, 1);
      else copy.push(item.id);
      onHiddenIdsUpdated(copy);
    })
  }));
}

async function getSidebarItemsAsMenuItems(): Promise<MenuItem[]> {
  const customizableSidebar = await isFeatureAvailable("customizableSidebar");
  const colors = useAppStore.getState().colors;
  const hiddenColors = customizableSidebar.isAllowed
    ? useAppStore.getState().hiddenColors
    : [];
  const hiddenRoutes = customizableSidebar.isAllowed
    ? useAppStore.getState().hiddenRoutes
    : [];
  return [
    {
      key: "reset-sidebar",
      type: "button",
      title: strings.resetSidebar(),
      onClick: () => {
        db.settings
          .setSideBarHiddenItems("routes", [])
          .then(() => db.settings.setSideBarHiddenItems("colors", []))
          .then(() => db.settings.setSideBarOrder("colors", []))
          .then(() => db.settings.setSideBarOrder("routes", []))
          .then(() => db.settings.setSideBarOrder("shortcuts", []))
          .then(() => {
            useAppStore.getState().setHiddenRoutes([]);
            useAppStore.getState().setHiddenColors([]);
          });
      },
      icon: Reset.path
    },
    { type: "separator", key: "sep" },
    ...toMenuItems(
      orderItems(routes, db.settings.getSideBarOrder("routes")),
      hiddenRoutes,
      (ids) =>
        db.settings
          .setSideBarHiddenItems("routes", ids)
          .then(() => useAppStore.getState().setHiddenRoutes(ids)),
      customizableSidebar,
      (item) => ({ icon: item.icon.path })
    ),
    { type: "separator", key: "sep", isHidden: colors.length <= 0 },
    ...toMenuItems(
      orderItems(colors, db.settings.getSideBarOrder("colors")),
      hiddenColors,
      (ids) =>
        db.settings
          .setSideBarHiddenItems("colors", ids)
          .then(() => useAppStore.getState().setHiddenColors(ids)),
      customizableSidebar,
      (item) => ({
        icon: Circle.path,
        styles: { icon: { color: item.colorCode } }
      })
    )
  ] as MenuItem[];
}

function navigateToRoute(path: string) {
  if (!isMobile() && getCurrentPath() === path) {
    if (useSearchStore.getState().isSearching)
      return useSearchStore.getState().resetSearch();
    return useAppStore.getState().toggleListPane();
  }
  useAppStore.getState().toggleListPane(true);
  navigate(path);
}
