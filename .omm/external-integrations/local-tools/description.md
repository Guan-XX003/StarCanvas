On-device tool processes for media editing and AI utilities, invoked through trusted IPC rather than external HTTP.

macOS Deface build inputs must contain a relocatable standalone CPython tree
(stdlib, extension modules and installed Deface dependencies), not a copied venv
whose pyvenv.cfg references the developer's Python. The wrapper invokes this
bundled interpreter with isolated mode (-I) and no bytecode writes (-B).
prepare-bundled-deface preserves the old generated venv outside shipped assets.
The platform copy hook and explicit verifier reject legacy venv manifests,
missing stdlib/model files and external symlinks/site paths before packaging.
Structural checks do not prove native media processing; acceptance must also run
the relocated command with developer Python and network access denied.
