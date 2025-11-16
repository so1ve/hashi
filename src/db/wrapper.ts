import type {
	ExtractType,
	ExtractTypeObject,
	MaybeArray,
	Table,
} from "../types";

export default class D1Wrapper<TB extends Table> {
	private db: D1Database;

	constructor(db: D1Database) {
		this.db = db;
	}

	private buildWhere(where?: Record<string, unknown>) {
		if (!where || Object.keys(where).length === 0) {
			return { clause: "", bindings: [] as unknown[] };
		}

		const parts: string[] = [];
		const bindings: unknown[] = [];

		for (const [k, v] of Object.entries(where)) {
			if (v === null) {
				parts.push(`${k} IS NULL`);
			} else if (Array.isArray(v)) {
				const placeholders = v.map(() => "?").join(", ");
				parts.push(`${k} IN (${placeholders})`);
				bindings.push(...v);
			} else {
				parts.push(`${k} = ?`);
				bindings.push(v);
			}
		}

		return { clause: parts.join(" AND "), bindings };
	}

	public async select<T extends keyof TB, const C extends keyof TB[T]>(
		table: T,
		columns?: C[] | null,
		where?: Partial<ExtractTypeObject<TB[T]>>,
	): Promise<{ [K in C]: ExtractType<TB[T][K]> }[]> {
		const cols = !columns || columns.length === 0 ? "*" : columns.join(", ");
		const { clause, bindings } = this.buildWhere(where);
		const sql = `SELECT ${cols} FROM ${table as string}${clause ? ` WHERE ${clause}` : ""}`;
		const res = await this.db
			.prepare(sql)
			.bind(...bindings)
			.all();

		return res.results as any;
	}

	public async insert<T extends keyof TB>(
		table: T,
		values: MaybeArray<ExtractTypeObject<TB[T]>>,
		options?: { or?: "ABORT" | "FAIL" | "IGNORE" | "REPLACE" | "ROLLBACK" },
	) {
		const rows = Array.isArray(values) ? values : [values];
		if (rows.length === 0) {
			return null;
		}

		const columns = Object.keys(rows[0]);
		if (columns.length === 0) {
			throw new Error("insert: no columns provided");
		}

		const placeholders = columns.map(() => "?").join(", ");
		const orClause = options?.or ? ` OR ${options.or}` : "";
		const sql = `INSERT${orClause} INTO ${table as string} (${columns.join(", ")}) VALUES (${placeholders})`;

		const results = [];
		for (const row of rows) {
			const binds = columns.map((c) => row[c]);
			const r = await this.db
				.prepare(sql)
				.bind(...binds)
				.run();
			results.push(r);
		}

		return rows.length === 1 ? results[0] : results;
	}

	public async update<T extends keyof TB>(
		table: T,
		updates: Partial<ExtractTypeObject<TB[T]>>,
		where?: Partial<ExtractTypeObject<TB[T]>>,
	) {
		const keys = Object.keys(updates);
		if (keys.length === 0) {
			throw new Error("update: no updates provided");
		}

		const setParts = keys.map((k) => `${k} = ?`).join(", ");
		const setBindings = keys.map((k) => updates[k]);

		const { clause, bindings: whereBindings } = this.buildWhere(where);

		const sql = `UPDATE ${table as string} SET ${setParts}${clause ? ` WHERE ${clause}` : ""}`;
		const allBindings = [...setBindings, ...whereBindings];

		const res = await this.db
			.prepare(sql)
			.bind(...allBindings)
			.run();

		return res;
	}
}
