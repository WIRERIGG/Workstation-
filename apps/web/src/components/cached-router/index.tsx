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

import React, { useEffect, useRef } from "react";
import { getHomeRoute, navigate, NavigationEvents } from "../../navigation";
import { store as selectionStore } from "../../stores/selection-store";
import { useStore as useSearchStore } from "../../stores/search-store";
import useRoutes from "../../hooks/use-routes";
import RouteContainer from "../route-container";
import routes from "../../navigation/routes";
import { Freeze } from "react-freeze";
import { Flex } from "@theme-ui/components";

function CachedRouter() {
  const [RouteResult, location] = useRoutes(routes, {
    fallbackRoute: getHomeRoute(),
    hooks: {
      beforeNavigate: (location) => {
        selectionStore.toggleSelectionMode(false);
        useSearchStore.getState().resetSearch();
        if (location === "/") {
          console.log("Redirecting to", getHomeRoute());
          navigate(getHomeRoute());
          return false;
        }
        return true;
      }
    }
  });
  const cachedRoutes = useRef<Record<string, React.FunctionComponent>>({});

  useEffect(() => {
    if (!RouteResult) return;
    NavigationEvents.publish("onNavigate", RouteResult, location);
  }, [RouteResult, location]);

  if (!RouteResult) return null;

  const isPlaceholder = RouteResult.type === "placeholder";

  // Workstation "placeholder" routes (dashboard, tasks, etc.) should not be
  // cached alongside Notesnook list routes (notes, notebooks, etc.).
  // When switching between the two worlds, evict the other world's cache
  // so frozen components don't take DOM space and block pane collapsing.
  // BUT: keep other workstation routes alive (e.g. terminal PTY survives
  // switching to dashboard and back).
  const WORKSTATION_KEYS = new Set([
    "dashboard", "tasks", "calendar", "agents", "spreadsheets",
    "communications", "agent-chat", "terminal", "files", "newsletters",
    "call-queue", "control", "git", "conversations", "workspaces"
  ]);

  if (isPlaceholder) {
    // Entering workstation view — evict only Notesnook (non-workstation) routes
    for (const key of Object.keys(cachedRoutes.current)) {
      if (!WORKSTATION_KEYS.has(key)) delete cachedRoutes.current[key];
    }
  } else {
    // Entering Notesnook view — evict all workstation cached routes
    for (const key of WORKSTATION_KEYS) {
      delete cachedRoutes.current[key];
    }
  }

  if (
    RouteResult.key === "general" ||
    !cachedRoutes.current[RouteResult.key] ||
    RouteResult.noCache
  )
    cachedRoutes.current[RouteResult.key] =
      RouteResult.component as React.FunctionComponent;

  const { key: routeKey, ...routeProps } = RouteResult;
  return (
    <RouteContainer key={routeKey} {...routeProps}>
      {Object.entries(cachedRoutes.current).map(([key, Component]) => (
        <Freeze key={key} freeze={key !== RouteResult.key}>
          <Flex
            id={key}
            key={key}
            sx={{
              flexDirection: "column",
              flex: 1,
              overflow: "hidden"
            }}
          >
            <Component key={key} {...RouteResult.props} />
          </Flex>
        </Freeze>
      ))}
    </RouteContainer>
  );
}

export default React.memo(CachedRouter);
