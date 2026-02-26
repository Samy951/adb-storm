import postgres from "postgres";

export type Db = ReturnType<typeof createDb>;

export function createDb() {
  const connectionString =
    process.env.DATABASE_URL || "postgres://storm:storm_dev@localhost:5432/storm";

  return postgres(connectionString, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}
