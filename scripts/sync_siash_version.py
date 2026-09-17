from pathlib import Path
import json, re

VERSION = "0.14.23"

# Regra permanente: toda versão SIASH deve ficar sincronizada no pacote,
# tela inicial/login, título da página e menu lateral.
pkg = Path("package.json")
data = json.loads(pkg.read_text(encoding="utf-8"))
data["version"] = VERSION
pkg.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

index = Path("index.html")
s = index.read_text(encoding="utf-8")ns = re.sub(r"(<title>SIASH \| HospitalIA UTIN — Alpha Consolidada )v\d+\.\d+\.\d+(</title>)", rf"\g<1>v{VERSION}\2", s)
s = re.sub(r"(UTI Neonatal • Alpha Consolidada )v\d+\.\d+\.\d+", rf"\g<1>v{VERSION}", s)
s = re.sub(r"(UTIN • )v\d+\.\d+\.\d+", rf"\g<1>v{VERSION}", s)
index.write_text(s, encoding="utf-8")

# Falha deliberadamente se qualquer uma das três superfícies não estiver sincronizada.
checks = [
    f"Alpha Consolidada v{VERSION}</title>",
    f"UTI Neonatal • Alpha Consolidada v{VERSION}",
    f"UTIN • v{VERSION}",
]
final = index.read_text(encoding="utf-8")
missing = [x for x in checks if x not in final]
if missing:
    raise SystemExit("Falha na sincronização visual da versão: " + " | ".join(missing))
if json.loads(pkg.read_text(encoding="utf-8")).get("version") != VERSION:
    raise SystemExit("package.json não sincronizado")
print(f"SIASH v{VERSION}: package + login + título + menu lateral sincronizados.")
