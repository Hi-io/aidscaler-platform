import pg from 'pg';
import { randomUUID } from 'node:crypto';

export function localPostgresUrl(value) {
  let url;
  try { url=new URL(value); } catch { throw Error('Supply a valid private local PostgreSQL URL.'); }
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))
    throw Error('Evaluation databases must use a loopback PostgreSQL instance.');
  return url;
}

// Each application gets an entire temporary database, including independent
// schema, migrations, jobs and credentials. No live/demo database is modified.
// Only generated names retained by this scope may be dropped during cleanup.
export async function createLocalEvaluationDatabases(databaseUrl,{poolFactory=options=>new pg.Pool(options)}={}) {
  const url=localPostgresUrl(databaseUrl),pool=poolFactory({connectionString:url.toString(),max:1,connectionTimeoutMillis:10000}),
    owned=new Set();
  let version=null,closePromise,closed=false;
  return {
    async createDatabase() {
      if(closed)throw Error('The evaluation database scope is closed.');
      if(version===null)version=(await pool.query('SHOW server_version')).rows[0].server_version;
      const name='aid_eval_'+randomUUID().replaceAll('-','');
      owned.add(name);
      try { await pool.query(`CREATE DATABASE "${name}" WITH TEMPLATE template0 ENCODING 'UTF8'`); }
      catch(error) { if(error.code==='42P04')owned.delete(name); throw error; }
      const connection=new URL(url);connection.pathname='/'+name;
      return connection.toString();
    },
    metadata() { return {backend:'postgres-native-local',serverVersion:version,isolation:'one disposable database per application',databases:owned.size}; },
    close() {
      if(closePromise)return closePromise;
      closed=true;
      return closePromise=(async()=>{
        const errors=[];
        for(const name of [...owned].reverse()) {
          if(!/^aid_eval_[a-f0-9]{32}$/.test(name)){errors.push(Error('Refusing to drop an unowned database name.'));continue;}
          try{await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);owned.delete(name);}
          catch(error){errors.push(error);}
        }
        try{await pool.end();}catch(error){errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'Evaluation database cleanup did not finish.');
      })();
    },
  };
}
