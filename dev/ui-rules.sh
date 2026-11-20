#!/usr/bin/env bash
# Screens render content only: the frame (ui/layout/PageFrame, metrics) owns what is over and
# under a page, the kit owns sizes and the ring's room. This fails when a screen works any of
# it out itself; and every press goes through kit/Pressable. Run from anywhere: dev/ui-rules.sh
set -euo pipefail
cd "$(dirname "$0")/../app/ui/screens"

# What a screen must not read or do, and why.
rules=(
  '\bsafeArea\(|the system bars: metrics / PageFrame'
  '\bnavRoom\(|what is over a page: metrics'
  '\bringRoom\(|the ring'"'"'s room: Rail, kit'
  'from "(\.\./)+layout/chrome"|the family: ask caps or the frame'
  'position: "absolute"|overlays: the frame places them'
)

bad=0
for rule in "${rules[@]}"; do
  # The pattern itself may hold "|": the reason is after the last one.
  pattern="${rule%|*}"
  why="${rule##*|}"
  if hits=$(grep -rnE "$pattern" . 2>/dev/null); then
    echo "screens must not: ${why}"
    echo "$hits" | sed 's/^/  /'
    bad=1
  fi
done
[ "$bad" = 0 ] && echo "ui rules: screens render content only"

# Presses go through kit/Pressable, which shows them (a dim or a row's fill from the finger
# down): a bare <View> or <Text> that hears a press shows nothing on a phone. Checked over the
# whole UI (not only the screens), from each opening tag to its ">" (its {…} balanced; lines that
# are only comments skipped). Not caught: other elements, and handlers passed on with {...rest}.
cd ..
presses=$(perl -e '
  local $/;
  for my $f (@ARGV) {
    open my $fh, "<", $f or die "$f: $!";
    my $s = <$fh>;
    $s =~ s{^[ \t]*//[^\n]*}{}mg;
    while ($s =~ /<(View|Text)\b/g) {
      my ($at, $from) = ($-[0], pos($s));
      if ($s =~ /\G((?:[^<>{}]|(\{(?:[^{}]++|(?2))*\}))*)>/g && $1 =~ /\bon(?:Press|PressDown|PressUp|LongPress)=/) {
        print "$f:", 1 + (substr($s, 0, $at) =~ tr/\n//), "\n";
      }
      pos($s) = $from;
    }
  }' $(find . -name '*.tsx' ! -path './kit/Pressable.tsx' | sort) ../App.tsx)
if [ -n "$presses" ]; then
  echo "presses go through kit/Pressable (it shows the press), not a bare View or Text:"
  echo "$presses" | sed 's/^/  /'
  bad=1
else
  echo "ui rules: every press goes through kit/Pressable"
fi
exit "$bad"
