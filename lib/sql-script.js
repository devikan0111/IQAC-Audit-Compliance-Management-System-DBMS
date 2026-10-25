// Parser for the bundled line-delimited MySQL client scripts (including triggers).
export function sqlStatements(source){
 let delimiter=';',statement='';const result=[];
 for(const line of source.split(/\r?\n/)){
 if(line.trim().startsWith('--'))continue;
 if(line.trim().startsWith('DELIMITER ')){
 if(statement.trim())throw Error('Delimiter changed inside a statement');
 delimiter=line.trim().slice(10).trim();if(!delimiter)throw Error('Missing delimiter');continue;
 }
 statement+=line+'\n';
 if(statement.trimEnd().endsWith(delimiter)){
 const sql=statement.trimEnd().slice(0,-delimiter.length).trim();
 if(sql)result.push(sql);statement='';
 }
 }
 if(statement.trim())throw Error('Unterminated SQL statement');
 return result;
}
