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

import platform from "platform";
import { appVersion } from "../utils/version";

export function getPlatform() {
  if (window.os) return window.os();

  const userAgent = window.navigator.userAgent,
    platform = window.navigator.platform,
    macosPlatforms = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"],
    windowsPlatforms = ["Win32", "Win64", "Windows", "WinCE"],
    iosPlatforms = ["iPhone", "iPad", "iPod"],
    os = null;

  if (macosPlatforms.indexOf(platform) !== -1) {
    return "macOS";
  } else if (iosPlatforms.indexOf(platform) !== -1) {
    return "iOS";
  } else if (windowsPlatforms.indexOf(platform) !== -1) {
    return "Windows";
  } else if (/Android/.test(userAgent)) {
    return "Android";
  } else if (!os && /Linux/.test(platform)) {
    return "Linux";
  }

  return os;
}

export function getDownloadLink(platform: string) {
  const baseurl = `https://workstation.com/releases/${platform.toLowerCase()}`;
  switch (platform) {
    case "iOS":
      return [
        {
          type: "Install from App Store",
          link: "https://apps.apple.com/pk/app/workstation-take-private-notes/id1544027013"
        }
      ];
    case "Android":
      return [
        {
          type: "Install from Google Play Store",
          link: "https://play.google.com/store/apps/details?id=com.streetwriters.workstation"
        },
        {
          type: "Download .apk (arm64-v8a)",
          link: `${baseurl}/workstation-arm64-v8a.apk`
        },
        {
          type: "Download .apk (armeabi-v7a)",
          link: `${baseurl}/workstation-armeabi-v7a.apk`
        },
        {
          type: "Download .apk (x86)",
          link: `${baseurl}/workstation-x86.apk`
        },
        {
          type: "Download .apk (x86_64)",
          link: `${baseurl}/workstation-x86_64.apk`
        }
      ];
    case "macOS":
      return [
        {
          type: "Download .dmg (x64)",
          link: `${baseurl}/workstation_mac_x64.dmg`
        },
        {
          type: "Download .dmg (arm64)",
          link: `${baseurl}/workstation_mac_arm64.dmg`
        }
      ];
    case "Windows":
      return [
        {
          type: "Download .exe (x64)",
          link: `${baseurl}/workstation_win_x64.exe`
        },
        {
          type: "Download portable .exe (x64)",
          link: `${baseurl}/workstation_win_x64_portable.exe`
        }
      ];
    case "Linux":
      return [
        {
          type: "Download .AppImage",
          link: `${baseurl}/workstation_linux_x86_64.AppImage`
        },
        {
          type: "Download .deb",
          link: `${baseurl}/workstation_linux_amd64.deb`
        },
        {
          type: "Download .rpm",
          link: `${baseurl}/workstation_linux_x86_64.rpm`
        }
      ];
    default:
      return [
        {
          type: "Download",
          link: "https://github.com/streetwriters/workstation/releases/"
        }
      ];
  }
}

declare const IS_DESKTOP_APP: boolean;

/**
 * Runtime check for whether we're running inside Electron.
 * Works even when Vite's `define` doesn't replace IS_DESKTOP_APP in dev mode.
 */
export function isDesktopRuntime(): boolean {
  if (typeof window !== "undefined" && !!(window as any).electronTRPC) return true;
  if (typeof IS_DESKTOP_APP !== "undefined") return IS_DESKTOP_APP;
  return false;
}

export function isMac() {
  return (
    getPlatform() === "macOS" || getPlatform() === "darwin" || isMacStoreApp()
  );
}

export function isMacStoreApp() {
  return window.os ? window.os() === "mas" : false;
}

export function getDeviceInfo(extras: string[] = []) {
  const version = appVersion.formatted;
  const os = platform.os;
  const browser = `${platform.name} ${platform.version}`;

  return `App version: ${version}
OS: ${os}
Browser: ${browser}
${extras.join("\n")}`;
}
