import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: 'src/data/schema-index.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/vico.db',
  },
});
