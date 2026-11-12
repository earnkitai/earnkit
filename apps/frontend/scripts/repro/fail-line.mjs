// FR-4 (v6.1.18): run.sh loads this before the script. An error the script did not catch (a refused target at import,
// a database error in cleanup.mts, a rejected top-level await) prints one line, `FAIL <id>: <message>`, never a stack,
// and exits 1. The id is the script's name (`l23-2.mts` reads L23-2). Messages here never hold a token: the scripts'
// own lines go through lib.mts's redaction, and these are thrown before or outside it.
const name = process.env.REPRO_SCRIPT || 'script';
const id = /^l\d/.test(name) ? name.toUpperCase() : name;
const fail = (e) => {
  const msg = String(e?.message ?? e).split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 300);
  console.log(`FAIL ${id}: ${msg || 'error'}`);
  process.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
