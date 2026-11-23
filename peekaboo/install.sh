#!/bin/sh
# Peekaboo installer. Runs as root through the plugin manager; its output is
# shown in the install dialog. The plugin is its own files and nothing else:
# nothing is put outside the plugin folder, so there is nothing to take back.
# Volumio runs this with sh, so it keeps to what sh has.

echo "Installing Peekaboo"

PLUGIN_DIR="/data/plugins/system_controller/peekaboo"

if [ -d "$PLUGIN_DIR" ]; then
  chown -R volumio:volumio "$PLUGIN_DIR"
fi

echo "Peekaboo installed"
echo "Switch the plugin on, then have the reverse proxy forward to the port its page names"
echo "plugininstallend"
