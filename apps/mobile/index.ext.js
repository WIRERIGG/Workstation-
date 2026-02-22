/* eslint-disable @typescript-eslint/no-var-requires */
import React from "react";
import { AppRegistry } from "react-native";
import "react-native-get-random-values";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "./globals";
import "./app/common/logger/index";

const ShareProvider = () => {
  WorkstationShare = require("./app/share/index").default;
  return (
    <SafeAreaProvider>
      <WorkstationShare />
    </SafeAreaProvider>
  );
};

AppRegistry.registerComponent("WorkstationShare", () => ShareProvider);
