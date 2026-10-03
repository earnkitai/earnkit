import { skeleton } from './lib/earnkit/confusables';
import { reservedNameProblem } from './lib/earnkit/sponsor-identity';
for (const n of ['ᗷᗩᔕᗴ','ⲂⲀⲤⲈ','ⲃⲁⲥⲉ','ᗰOᑎᗩᗪ']) console.log(n, JSON.stringify(skeleton(n)), !!reservedNameProblem(n,null));
