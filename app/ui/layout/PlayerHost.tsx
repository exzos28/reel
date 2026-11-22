// Where the player shows. On iOS a full-screen dialog of its own: the status bar hides while a
// film plays (NSH sets it per page or dialog, and the dialog is the newest). The pages stay under
// it as they are (App.tsx). An iPad's player turns with the device; a phone's stays upright as the
// app does, and draws itself sideways (`Player`'s turned box). Elsewhere the player is the app's
// only content as it is (the pages hidden).
import type { JSX } from "nsh";
import { Dialog } from "nsh/base";
import { family, runtime } from "../platform";
import { colors } from "../theme";

/** The player is a layer of its own over the pages (iOS's dialog): the pages under it need not
 * be hidden. Elsewhere it takes their place. */
export const playerOverPages = runtime.os === "ios";

export function PlayerHost(props: { children: JSX.Element }) {
  if (!playerOverPages) return props.children;
  return (
    <Dialog
      testID="player-host"
      presentation="fullScreen"
      animation="fade"
      statusBar={{ hidden: true, animated: true }}
      closeOnEscape={false}
      closeOnSwipe={false}
      ios={family === "phone" ? undefined : { supportedOrientations: ["portrait", "landscape"] }}
      style={{ flex: 1, backgroundColor: colors.ink() }}
    >
      {props.children}
    </Dialog>
  );
}
