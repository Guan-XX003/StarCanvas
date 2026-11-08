Downloads or externalizes generated media into project storage and restores playable local URLs when projects reopen.

Image editor saves persist the edited media under a new image node ID, then append
that node beside the source on the root canvas. The original image, its review
identity, and existing downstream references stay unchanged; edited nodes do not
inherit reviewed portrait identity. Persistence failures leave the editor open
and the canvas unchanged.
