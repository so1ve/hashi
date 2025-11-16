import { env } from "cloudflare:workers";

import { defaultSettings, defaultTexts } from "../settings";
import type { SettingsKey, TableStructure, TextsKey } from "../types";
import { expectedTables } from "./table";
import { db } from ".";

const { DB } = env;

async function createTable(tableName: string, structure: TableStructure) {
	const columnsDef = Object.entries(structure)
		.map(([name, def]) => `${name} ${def}`)
		.join(", ");
	const createSQL = `CREATE TABLE ${tableName} (${columnsDef})`;
	await DB.exec(createSQL);
}

export async function initializeTables() {
	for (const [tableName, structure] of Object.entries(expectedTables)) {
		const tableInfo = await DB.prepare(
			`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
		)
			.bind(tableName)
			.first();

		if (!tableInfo) {
			await createTable(tableName, structure);
			continue;
		}

		const columnsResult = await DB.prepare(
			`PRAGMA table_info(${tableName})`,
		).all();

		const currentColumns = new Map(
			columnsResult.results.map((col) => [
				col.name,
				{
					type: col.type,
					notnull: col.notnull,
					dflt_value: col.dflt_value,
				},
			]),
		);

		for (const [colName, colDef] of Object.entries(structure)) {
			if (!currentColumns.has(colName)) {
				const columnParts = colDef.split(" ");
				const addColumnSQL = `ALTER TABLE ${tableName} ADD COLUMN ${colName} ${columnParts.slice(1).join(" ")}`;
				await DB.exec(addColumnSQL);
			}
		}
	}

	await initializeSettings();
}

function initializeSettings() {
	const promises = [];

	for (const [key, value] of Object.entries(defaultSettings)) {
		promises.push(
			db.insert(
				"settings",
				{ key: key as SettingsKey, value },
				{ or: "IGNORE" },
			),
		);
	}

	for (const [key, value] of Object.entries(defaultTexts)) {
		promises.push(
			db.insert("texts", { key: key as TextsKey, value }, { or: "IGNORE" }),
		);
	}

	return Promise.all(promises);
}
