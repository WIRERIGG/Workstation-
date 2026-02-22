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

import { useState, useEffect } from "react";
import { Box, Button, Flex, Input, Text } from "@theme-ui/components";
import { AppEventManager, AppEvents } from "../common/app-events";
import {
  useStore as useSpreadsheetStore,
  Spreadsheet,
  CellValue
} from "../stores/spreadsheet-store";

// ── New Sheet Form ──

function NewSheetForm({ onClose }: { onClose: () => void }) {
  const addSpreadsheet = useSpreadsheetStore((s) => s.addSpreadsheet);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [columnsStr, setColumnsStr] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    const columns = columnsStr
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    if (columns.length === 0) columns.push("Column A", "Column B", "Column C");
    addSpreadsheet(name.trim(), description.trim(), columns);
    onClose();
  };

  return (
    <Flex
      sx={{
        flexDirection: "column",
        bg: "background-secondary",
        borderRadius: 8,
        border: "1px solid var(--border)",
        p: 3,
        gap: 2
      }}
    >
      <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}>
        New Spreadsheet
      </Text>
      <Input
        placeholder="Sheet name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        sx={{ fontSize: 13 }}
        autoFocus
      />
      <Input
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        sx={{ fontSize: 12 }}
      />
      <Input
        placeholder="Columns (comma-separated, e.g. Name, Amount, Status)"
        value={columnsStr}
        onChange={(e) => setColumnsStr(e.target.value)}
        sx={{ fontSize: 12 }}
      />
      <Flex sx={{ gap: 1 }}>
        <Button
          variant="accent"
          sx={{ fontSize: 12 }}
          onClick={handleCreate}
          disabled={!name.trim()}
        >
          Create Sheet
        </Button>
        <Button variant="secondary" sx={{ fontSize: 12 }} onClick={onClose}>
          Cancel
        </Button>
      </Flex>
    </Flex>
  );
}

// ── Sheet Card ──

function SheetCard({
  sheet,
  isSelected,
  onSelect
}: {
  sheet: Spreadsheet;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const deleteSpreadsheet = useSpreadsheetStore((s) => s.deleteSpreadsheet);

  return (
    <Flex
      onClick={onSelect}
      sx={{
        flexDirection: "column",
        bg: isSelected ? "hover" : "background-secondary",
        borderRadius: 8,
        p: 3,
        border: isSelected
          ? "2px solid var(--accent)"
          : "1px solid var(--border)",
        cursor: "pointer",
        gap: 1,
        "&:hover": { bg: "hover" }
      }}
    >
      <Flex sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}>
          📊 {sheet.name}
        </Text>
        <Button
          variant="secondary"
          sx={{ fontSize: 10, px: 1, py: "2px", color: "#ef4444" }}
          onClick={(e) => {
            e.stopPropagation();
            deleteSpreadsheet(sheet.id);
          }}
        >
          Delete
        </Button>
      </Flex>
      <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>
        {sheet.description}
      </Text>
      <Flex sx={{ alignItems: "center", gap: 2, mt: 1 }}>
        <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
          {sheet.rows.length} rows &middot; {sheet.columns.length} columns
        </Text>
        {sheet.createdBy === "agent" && (
          <Text sx={{ fontSize: 10, color: "#f59e0b" }}>🤖 Agent-created</Text>
        )}
      </Flex>
    </Flex>
  );
}

// ── Data Cell ──

function DataCell({
  value,
  isEditing,
  onStartEdit,
  onSave
}: {
  value: CellValue;
  isEditing: boolean;
  onStartEdit: () => void;
  onSave: (val: CellValue) => void;
}) {
  const [editValue, setEditValue] = useState(String(value ?? ""));

  if (isEditing) {
    return (
      <Input
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={() => {
          const num = Number(editValue);
          onSave(editValue === "" ? null : isNaN(num) ? editValue : num);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const num = Number(editValue);
            onSave(editValue === "" ? null : isNaN(num) ? editValue : num);
          }
          if (e.key === "Escape") onSave(value);
        }}
        autoFocus
        sx={{
          width: "100%",
          height: "100%",
          border: "2px solid var(--accent)",
          borderRadius: 2,
          bg: "background",
          color: "heading",
          fontSize: 12,
          px: 1,
          outline: "none"
        }}
      />
    );
  }

  const isNumber = typeof value === "number";

  return (
    <Flex
      onClick={onStartEdit}
      sx={{
        width: "100%",
        height: "100%",
        alignItems: "center",
        px: 2,
        cursor: "cell",
        "&:hover": { bg: "hover" }
      }}
    >
      <Text
        sx={{
          fontSize: 12,
          color: value === null ? "paragraph-secondary" : "heading",
          textAlign: isNumber ? "right" : "left",
          width: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {value === null
          ? "—"
          : isNumber
          ? value.toLocaleString()
          : String(value)}
      </Text>
    </Flex>
  );
}

// ── Spreadsheet Grid ──

function SpreadsheetGrid({ sheet }: { sheet: Spreadsheet }) {
  const editingCell = useSpreadsheetStore((s) => s.editingCell);
  const setEditingCell = useSpreadsheetStore((s) => s.setEditingCell);
  const updateCell = useSpreadsheetStore((s) => s.updateCell);
  const addRow = useSpreadsheetStore((s) => s.addRow);
  const deleteRow = useSpreadsheetStore((s) => s.deleteRow);
  const addColumn = useSpreadsheetStore((s) => s.addColumn);
  const deleteColumn = useSpreadsheetStore((s) => s.deleteColumn);
  const renameSpreadsheet = useSpreadsheetStore((s) => s.renameSpreadsheet);
  const deleteSpreadsheet = useSpreadsheetStore((s) => s.deleteSpreadsheet);
  const selectSheet = useSpreadsheetStore((s) => s.selectSheet);

  const [showAddCol, setShowAddCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(sheet.name);

  const handleAddColumn = () => {
    if (!newColName.trim()) return;
    addColumn(sheet.id, newColName.trim());
    setNewColName("");
    setShowAddCol(false);
  };

  const handleSaveName = () => {
    if (nameValue.trim()) {
      renameSpreadsheet(sheet.id, nameValue.trim());
    }
    setEditingName(false);
  };

  return (
    <Flex sx={{ flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Sheet header */}
      <Flex
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          pb: 2,
          borderBottom: "1px solid var(--border)",
          mb: 2,
          gap: 2
        }}
      >
        <Flex sx={{ flexDirection: "column", flex: 1 }}>
          {editingName ? (
            <Input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveName();
                if (e.key === "Escape") {
                  setNameValue(sheet.name);
                  setEditingName(false);
                }
              }}
              autoFocus
              sx={{ fontSize: 16, fontWeight: "bold" }}
            />
          ) : (
            <Text
              sx={{
                fontSize: 16,
                fontWeight: "bold",
                color: "heading",
                cursor: "pointer",
                "&:hover": { textDecoration: "underline" }
              }}
              onClick={() => setEditingName(true)}
            >
              {sheet.name}
            </Text>
          )}
          <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
            Last updated {new Date(sheet.updatedAt).toLocaleString()}
          </Text>
        </Flex>
        <Flex sx={{ gap: 1 }}>
          <Button
            variant="secondary"
            sx={{ fontSize: 11, px: 2, py: 1 }}
            onClick={() => addRow(sheet.id)}
          >
            + Row
          </Button>
          <Button
            variant="secondary"
            sx={{ fontSize: 11, px: 2, py: 1 }}
            onClick={() => setShowAddCol(!showAddCol)}
          >
            + Column
          </Button>
          <Button
            variant="secondary"
            sx={{ fontSize: 11, px: 2, py: 1, color: "#ef4444" }}
            onClick={() => {
              deleteSpreadsheet(sheet.id);
            }}
          >
            Delete Sheet
          </Button>
        </Flex>
      </Flex>

      {/* Add Column Form */}
      {showAddCol && (
        <Flex sx={{ gap: 1, mb: 2, alignItems: "center" }}>
          <Input
            placeholder="Column name"
            value={newColName}
            onChange={(e) => setNewColName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddColumn();
              if (e.key === "Escape") setShowAddCol(false);
            }}
            autoFocus
            sx={{ fontSize: 12, flex: 1, maxWidth: 200 }}
          />
          <Button
            variant="accent"
            sx={{ fontSize: 11, px: 2, py: 1 }}
            onClick={handleAddColumn}
            disabled={!newColName.trim()}
          >
            Add
          </Button>
          <Button
            variant="secondary"
            sx={{ fontSize: 11, px: 2, py: 1 }}
            onClick={() => setShowAddCol(false)}
          >
            Cancel
          </Button>
        </Flex>
      )}

      {/* Table */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <Box
          as="table"
          sx={{
            width: "100%",
            borderCollapse: "collapse",
            "& th, & td": {
              border: "1px solid var(--border)",
              height: 32,
              minWidth: 100
            }
          }}
        >
          <Box as="thead">
            <Box as="tr">
              <Box
                as="th"
                sx={{
                  width: 40,
                  bg: "background-secondary",
                  fontSize: 10,
                  color: "paragraph-secondary",
                  textAlign: "center",
                  fontWeight: "bold"
                }}
              >
                #
              </Box>
              {sheet.columns.map((col, i) => (
                <Box
                  as="th"
                  key={i}
                  sx={{
                    bg: "background-secondary",
                    fontSize: 11,
                    fontWeight: "bold",
                    color: "heading",
                    textAlign: "left",
                    px: 2,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    position: "relative"
                  }}
                >
                  <Flex sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    {col}
                    {sheet.columns.length > 1 && (
                      <Text
                        sx={{
                          fontSize: 9,
                          color: "#ef4444",
                          cursor: "pointer",
                          opacity: 0.5,
                          "&:hover": { opacity: 1 }
                        }}
                        onClick={() => deleteColumn(sheet.id, i)}
                      >
                        ✕
                      </Text>
                    )}
                  </Flex>
                </Box>
              ))}
              <Box
                as="th"
                sx={{
                  width: 30,
                  bg: "background-secondary"
                }}
              />
            </Box>
          </Box>
          <Box as="tbody">
            {sheet.rows.map((row, rowIndex) => (
              <Box as="tr" key={rowIndex}>
                <Box
                  as="td"
                  sx={{
                    bg: "background-secondary",
                    fontSize: 10,
                    color: "paragraph-secondary",
                    textAlign: "center"
                  }}
                >
                  {rowIndex + 1}
                </Box>
                {row.map((cell, colIndex) => (
                  <Box as="td" key={colIndex} sx={{ p: 0 }}>
                    <DataCell
                      value={cell}
                      isEditing={
                        editingCell?.row === rowIndex &&
                        editingCell?.col === colIndex
                      }
                      onStartEdit={() =>
                        setEditingCell({ row: rowIndex, col: colIndex })
                      }
                      onSave={(val) => {
                        updateCell(sheet.id, rowIndex, colIndex, val);
                        setEditingCell(null);
                      }}
                    />
                  </Box>
                ))}
                <Box
                  as="td"
                  sx={{
                    p: 0,
                    textAlign: "center",
                    width: 30,
                    cursor: "pointer",
                    color: "#ef4444",
                    opacity: 0.4,
                    "&:hover": { opacity: 1 },
                    fontSize: 11
                  }}
                  onClick={() => deleteRow(sheet.id, rowIndex)}
                >
                  ✕
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Summary row */}
      {sheet.rows.length > 0 && (
        <Flex
          sx={{
            mt: 2,
            pt: 2,
            borderTop: "1px solid var(--border)",
            gap: 3,
            flexWrap: "wrap"
          }}
        >
          {sheet.columns.map((col, colIndex) => {
            const numericValues = sheet.rows
              .map((r) => r[colIndex])
              .filter((v): v is number => typeof v === "number");
            if (numericValues.length === 0) return null;
            const sum = numericValues.reduce((a, b) => a + b, 0);
            return (
              <Flex key={colIndex} sx={{ gap: 1, alignItems: "center" }}>
                <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
                  {col}:
                </Text>
                <Text sx={{ fontSize: 11, fontWeight: "bold", color: "heading" }}>
                  Sum {sum.toLocaleString()}
                </Text>
                <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
                  Avg {(sum / numericValues.length).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </Text>
              </Flex>
            );
          })}
        </Flex>
      )}
    </Flex>
  );
}

// ── Main View ──

function SpreadsheetsView() {
  const spreadsheets = useSpreadsheetStore((s) => s.spreadsheets);
  const selectedSheetId = useSpreadsheetStore((s) => s.selectedSheetId);
  const selectSheet = useSpreadsheetStore((s) => s.selectSheet);

  const [showNewSheet, setShowNewSheet] = useState(false);

  // Listen for dashboard quick-create event
  useEffect(() => {
    const sub = AppEventManager.subscribe(AppEvents.createNewSheet, () => {
      setShowNewSheet(true);
    });
    return () => sub.unsubscribe();
  }, []);

  const selectedSheet = spreadsheets.find((s) => s.id === selectedSheetId);

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
            Spreadsheets
          </Text>
          <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
            {spreadsheets.length} sheets &middot; AI-powered data analysis
          </Text>
        </Flex>
        {!selectedSheet && (
          <Button
            variant="accent"
            sx={{ fontSize: 12, px: 2, py: 1 }}
            onClick={() => setShowNewSheet(!showNewSheet)}
          >
            {showNewSheet ? "Cancel" : "+ New Sheet"}
          </Button>
        )}
      </Flex>

      {/* Content */}
      {selectedSheet ? (
        <Flex sx={{ flex: 1, flexDirection: "column", minHeight: 0 }}>
          <Button
            variant="secondary"
            sx={{ fontSize: 11, px: 2, py: 1, alignSelf: "flex-start", mb: 2 }}
            onClick={() => selectSheet(null)}
          >
            ← Back to all sheets
          </Button>
          <SpreadsheetGrid sheet={selectedSheet} />
        </Flex>
      ) : (
        <Flex sx={{ flexDirection: "column", gap: 2 }}>
          {showNewSheet && (
            <NewSheetForm onClose={() => setShowNewSheet(false)} />
          )}
          {spreadsheets.map((sheet) => (
            <SheetCard
              key={sheet.id}
              sheet={sheet}
              isSelected={false}
              onSelect={() => selectSheet(sheet.id)}
            />
          ))}
          {spreadsheets.length === 0 && !showNewSheet && (
            <Flex
              sx={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                py: 6
              }}
            >
              <Text sx={{ color: "paragraph-secondary", fontSize: 13 }}>
                No spreadsheets yet. Create one to get started.
              </Text>
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
}

export default SpreadsheetsView;
