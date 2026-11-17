// Where drizzle-kit reads the library schema and writes its migrations; `npm run db:generate` runs it.
export default { dialect: 'sqlite', schema: './src/shared/library/schema.ts', out: './src/shared/library/migrations' }
