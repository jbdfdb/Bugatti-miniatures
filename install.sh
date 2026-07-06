#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  Installation de « Les Bugatti de Pascal » — à lancer UNE fois.
#  Crée l'environnement Python et pose l'alias « bugatti ».
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
REPO="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

c_gold="\033[38;5;179m"; c_off="\033[0m"; c_dim="\033[2m"
say()  { echo -e "${c_gold}🏎️  $*${c_off}"; }
info() { echo -e "${c_dim}$*${c_off}"; }
die()  { echo -e "\033[31m✖ $*${c_off}" >&2; exit 1; }

say "Installation dans : $REPO"

# 1) Trouver un Python ≥ 3.11
PY=""
for cand in python3.13 python3.12 python3.11 python3; do
    if command -v "$cand" >/dev/null 2>&1; then
        ver="$($cand -c 'import sys;print("%d.%d"%sys.version_info[:2])')"
        major="${ver%.*}"; minor="${ver#*.}"
        if [ "$major" -ge 3 ] && [ "$minor" -ge 11 ]; then PY="$cand"; break; fi
    fi
done
[ -z "$PY" ] && die "Python 3.11+ introuvable. Installez-le :  brew install python@3.13"
say "Python détecté : $PY ($($PY --version))"

# 2) Environnement virtuel
if [ ! -d .venv ]; then
    say "Création de l'environnement virtuel…"
    "$PY" -m venv .venv
fi
VENV_PY="$REPO/.venv/bin/python"

# 3) Dépendances — versions FIGÉES (requirements.txt), installées DANS le .venv.
#    Pas besoin de Poetry ; et tout le monde obtient exactement les mêmes
#    versions (dev, ami, VPS) → plus de surprise du type « starlette a changé ».
say "Installation des dépendances (versions figées)…"
"$VENV_PY" -m pip install --quiet --upgrade pip
"$VENV_PY" -m pip install --quiet -r "$REPO/requirements.txt"

# 4) Rendre le lanceur exécutable
chmod +x "$REPO/bin/bugatti"

# 5) Poser l'alias dans le profil du shell de connexion de l'utilisateur
#    (on se base sur $SHELL, PAS sur le shell qui exécute ce script — qui est
#    toujours bash via le shebang).
case "${SHELL:-}" in
    */zsh)  SHELL_RC="$HOME/.zshrc" ;;
    */bash) SHELL_RC="$HOME/.bashrc" ;;
    *)      SHELL_RC="$HOME/.zshrc" ;;  # défaut macOS
esac
ALIAS_LINE="alias bugatti=\"$REPO/bin/bugatti\""
if ! grep -qsF "$REPO/bin/bugatti" "$SHELL_RC" 2>/dev/null; then
    {
        echo ""
        echo "# Les Bugatti de Pascal"
        echo "$ALIAS_LINE"
    } >> "$SHELL_RC"
    say "Alias « bugatti » ajouté dans $SHELL_RC"
else
    info "Alias « bugatti » déjà présent dans $SHELL_RC"
fi

echo ""
say "Installation terminée ! 🎉"
echo ""
echo "  Ouvrez un NOUVEAU terminal (ou lancez : source $SHELL_RC)"
echo "  puis tapez :"
echo ""
echo -e "      ${c_gold}bugatti run${c_off}"
echo ""
info "Au premier lancement, cliquez le bouton « Admin » en bas à droite"
info "pour choisir votre mot de passe d'administration."
