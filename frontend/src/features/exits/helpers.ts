export const human=(s:string)=>s.toLowerCase().replaceAll("_"," ").replace(/^./,c=>c.toUpperCase());
