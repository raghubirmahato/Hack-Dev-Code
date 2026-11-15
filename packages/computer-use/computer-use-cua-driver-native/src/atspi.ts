/**
 * Linux window controls through AT-SPI, the Linux accessibility bus: read a window as numbered controls, find
 * controls by name, type or accessible id, and operate them by number, in the same line format the Windows UI
 * Automation helper uses, so `desktop_window read` and `desktop_element` work alike on both systems.
 * @module @hackdevcode/dsh-computer-use-cua-driver-native/atspi
 */

/** Packages for window controls through AT-SPI on Debian and Ubuntu. */
export const ATSPI_HELPERS = 'sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core'

/**
 * Python that reads or operates the controls of one window. Arguments: mode (`read`, `find`, `point` or `act`), the
 * window's process id, its title, then the mode's own: find takes name, role, accessible id and a limit; point takes
 * an index; act takes an index, an action and a value.
 *
 * Every mode walks the window's accessible tree in the same depth-first order (up to 4000 elements and 8 seconds,
 * not entering web pages that are not showing)
 * and numbers each useful element (one with a name, a value, or a control role) from 1, so the numbers of a read
 * stay valid for find, point and act while the window keeps the same controls. A process exists per call, so no
 * numbering survives between calls except through that order.
 */
export const ATSPI_CONTROLS = String.raw`
import sys, time
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

ROLES = {
    'PushButton': 'Button', 'ToggleButton': 'Button', 'CheckBox': 'CheckBox', 'RadioButton': 'RadioButton',
    'Text': 'Edit', 'Entry': 'Edit', 'PasswordText': 'Edit', 'Terminal': 'Edit', 'DocumentText': 'Document',
    'DocumentFrame': 'Document', 'DocumentWeb': 'Document', 'ComboBox': 'ComboBox', 'MenuItem': 'MenuItem',
    'CheckMenuItem': 'MenuItem', 'RadioMenuItem': 'MenuItem', 'Menu': 'MenuItem', 'PageTab': 'TabItem',
    'ListItem': 'ListItem', 'TableCell': 'ListItem', 'TreeItem': 'TreeItem', 'Link': 'Hyperlink', 'Slider': 'Slider',
    'SpinButton': 'Spinner', 'Label': 'Text', 'Static': 'Text',
}
CONTROLS = set(['Edit', 'Document', 'ComboBox', 'Button', 'CheckBox', 'RadioButton', 'Slider', 'Spinner', 'MenuItem', 'TabItem', 'ListItem', 'TreeItem', 'Hyperlink'])

def kind(node):
    raw = (node.get_role_name() or '').title().replace(' ', '')
    return ROLES.get(raw, raw)

# Web content fills container values with object replacement characters, one per embedded child: noise to drop.
EMBEDDED = chr(0xFFFC)

def clean(text):
    return ' '.join((text or '').replace(EMBEDDED, ' ').split())

def quote(text, limit=200):
    # Long values keep their start and their end, where new typing usually lands.
    if len(text) > limit:
        text = text[:limit // 2] + ' ... ' + text[-(limit // 2):]
    return '"' + text.replace('"', "'") + '"'

def value_of(node):
    try:
        text = node.get_text_iface()
        if text is not None:
            count = Atspi.Text.get_character_count(text)
            if count <= 4000:
                return clean(Atspi.Text.get_text(text, 0, count))
            return clean(Atspi.Text.get_text(text, 0, 2000)) + ' ... ' + clean(Atspi.Text.get_text(text, count - 2000, count))
    except Exception:
        pass
    try:
        value = node.get_value_iface()
        if value is not None:
            number = Atspi.Value.get_current_value(value)
            return str(int(number)) if number == int(number) else str(number)
    except Exception:
        pass
    return ''

def states(node):
    out = []
    try:
        s = node.get_state_set()
        if not s.contains(Atspi.StateType.SENSITIVE):
            out.append('disabled')
        if s.contains(Atspi.StateType.FOCUSED):
            out.append('focused')
        if s.contains(Atspi.StateType.CHECKABLE) or kind(node) in ('CheckBox', 'RadioButton'):
            out.append('checked' if s.contains(Atspi.StateType.CHECKED) else 'unchecked')
        if s.contains(Atspi.StateType.EXPANDABLE):
            out.append('expanded' if s.contains(Atspi.StateType.EXPANDED) else 'collapsed')
        if s.contains(Atspi.StateType.SELECTED):
            out.append('selected')
        if kind(node) == 'Edit' and not s.contains(Atspi.StateType.EDITABLE):
            out.append('read-only')
    except Exception:
        pass
    return ' (' + ', '.join(out) + ')' if out else ''

def showing(node):
    try:
        return node.get_state_set().contains(Atspi.StateType.SHOWING)
    except Exception:
        return False

def centre(node):
    try:
        s = node.get_state_set()
        if not s.contains(Atspi.StateType.SHOWING):
            return None
        component = node.get_component_iface()
        box = Atspi.Component.get_extents(component, Atspi.CoordType.SCREEN)
        if box.width <= 0 or box.height <= 0:
            return None
        if box.x == 0 and box.y == 0:
            # GTK 4 knows positions inside its window only and reports (0, 0) on screen for every control.
            inner = Atspi.Component.get_extents(component, Atspi.CoordType.WINDOW)
            if inner.x != 0 or inner.y != 0:
                return None
        return (int(round(box.x + box.width / 2.0)), int(round(box.y + box.height / 2.0)))
    except Exception:
        return None

def describe(node):
    name = clean(node.get_name())
    role = kind(node)
    value = value_of(node)
    line = role
    if name:
        line += ' ' + quote(name)
    if value and value != name:
        line += ' = ' + quote(value, 2000 if role in ('Edit', 'Document') else 200)
    point = centre(node)
    if point is not None:
        line += ' @(' + str(point[0]) + ',' + str(point[1]) + ')'
    return line + states(node), bool(name or value or role in CONTROLS)

def accessible_id(node):
    try:
        return node.get_accessible_id() or ''
    except Exception:
        return ''

def frame_of(pid, title):
    desktop = Atspi.get_desktop(0)
    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        try:
            if app is None or app.get_process_id() != pid:
                continue
        except Exception:
            continue
        frames = [app.get_child_at_index(j) for j in range(app.get_child_count())]
        frames = [f for f in frames if f is not None]
        named = [f for f in frames if (f.get_name() or '') == title]
        return (named or frames or [None])[0]
    return None

def walk(frame):
    """Every useful element with its depth and number, in the order all modes share."""
    start, numbered, stack, visited = time.time(), [], [(frame, 0)], 0
    while stack and visited < 4000 and time.time() - start < 8:
        node, depth = stack.pop()
        visited += 1
        try:
            line, useful = describe(node)
            if node is not frame and useful:
                numbered.append((node, depth, line))
            # A web page that is not showing (a browser's background tab) can hold thousands of elements: it is listed
            # but not walked, so the window's own controls fit in the walk.
            if kind(node) == 'Document' and node is not frame and not showing(node):
                continue
            children = [node.get_child_at_index(k) for k in range(min(node.get_child_count(), 300))]
            for child in reversed([c for c in children if c is not None]):
                stack.append((child, depth + 1))
        except Exception:
            continue
    return numbered, bool(stack)

def element(numbered, index):
    if index < 1 or index > len(numbered):
        sys.exit('element [' + str(index) + '] is unknown for this window; read the window or find the element first')
    return numbered[index - 1][0]

def run_action(node, names):
    try:
        action = node.get_action_iface()
        if action is None:
            return False
        for i in range(Atspi.Action.get_n_actions(action)):
            # get_name gives the untranslated name; older AT-SPI has only the deprecated get_action_name.
            label = getattr(Atspi.Action, 'get_name', None) or Atspi.Action.get_action_name
            if (label(action, i) or '').lower() in names:
                return Atspi.Action.do_action(action, i)
    except Exception:
        return False
    return False

def main():
    mode, pid, title = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    frame = frame_of(pid, title)
    if frame is None:
        sys.exit('no accessible window for this process; the app may not expose accessibility')
    numbered, more = walk(frame)
    if mode == 'read':
        # Toolkits such as GTK expose every closed menu's items too; a read lists what is on screen (keeping the
        # shared numbers) so the window's own controls are not crowded out. A tree that marks nothing as showing
        # is listed whole.
        visible = set(index for index, (node, depth, line) in enumerate(numbered, 1) if showing(node))
        hidden = len(numbered) - len(visible) if visible else 0
        out, seen, size = [], set(), 0
        for index, (node, depth, line) in enumerate(numbered, 1):
            if visible and index not in visible:
                continue
            if line in seen:
                continue
            seen.add(line)
            row = '  ' * min(depth, 8) + '[' + str(index) + '] ' + line
            if len(out) >= 300 or size + len(row) > 8000:
                more = True
                break
            out.append(row)
            size += len(row) + 1
        if more:
            out.append('... more elements were not read')
        if hidden:
            out.append('(' + str(hidden) + ' more controls are hidden, such as the items of closed menus; open the menu, or find them by name)')
        print('\n'.join(out))
    elif mode == 'find':
        name, role, wanted_id, limit = clean(sys.argv[4]).lower(), sys.argv[5].strip().lower(), sys.argv[6].strip(), int(sys.argv[7])
        exact, partial = [], []
        for index, (node, depth, line) in enumerate(numbered, 1):
            if role and kind(node).lower() != role and (node.get_role_name() or '').replace(' ', '').lower() != role:
                continue
            if wanted_id and accessible_id(node) != wanted_id:
                continue
            own = clean(node.get_name()).lower()
            if not name or own == name:
                exact.append((index, line))
            elif name in own or name in value_of(node).lower():
                partial.append((index, line))
        rows = ['=[' + str(i) + '] ' + l for i, l in exact] + ['~[' + str(i) + '] ' + l for i, l in partial]
        print('\n'.join(rows[:limit]))
    elif mode == 'point':
        node = element(numbered, int(sys.argv[4]))
        point = centre(node)
        if point is None:
            if showing(node):
                sys.exit('element [' + sys.argv[4] + '] has no screen position (the app reports positions inside its window only); press it with invoke')
            sys.exit('element [' + sys.argv[4] + '] is off screen or hidden; scroll it into view or expand its parent first')
        print(str(point[0]) + ' ' + str(point[1]))
    elif mode == 'act':
        index, action, value = int(sys.argv[4]), sys.argv[5], sys.argv[6]
        node = element(numbered, index)
        fallback = centre(node)
        click = 'CLICK ' + str(fallback[0]) + ' ' + str(fallback[1]) if fallback else None
        done = False
        if action == 'invoke':
            done = run_action(node, ('click', 'press', 'activate', 'jump', 'toggle', 'open'))
        elif action == 'toggle':
            done = run_action(node, ('toggle', 'click', 'press', 'activate'))
        elif action in ('expand', 'collapse'):
            done = run_action(node, ('expand or contract', 'expand or collapse', action, 'open' if action == 'expand' else 'close'))
        elif action == 'select':
            try:
                parent = node.get_parent()
                selection = parent.get_selection_iface() if parent is not None else None
                if selection is not None:
                    done = Atspi.Selection.select_child(selection, node.get_index_in_parent())
            except Exception:
                done = False
            done = done or run_action(node, ('select', 'click', 'activate'))
        elif action == 'set_value':
            try:
                editable = node.get_editable_text_iface()
                if editable is not None:
                    done = Atspi.EditableText.set_text_contents(editable, value)
                else:
                    number = node.get_value_iface()
                    if number is not None:
                        done = Atspi.Value.set_current_value(number, float(value))
            except Exception:
                done = False
            if not done:
                if fallback is None:
                    sys.exit('element [' + str(index) + '] takes no direct value and is not on screen')
                print('TYPE ' + str(fallback[0]) + ' ' + str(fallback[1]))
                return
        elif action == 'focus':
            try:
                done = Atspi.Component.grab_focus(node.get_component_iface())
            except Exception:
                done = False
        else:
            sys.exit('unknown element action ' + action)
        if not done:
            if click is None:
                sys.exit('element [' + str(index) + '] does not support ' + action + ' and is not on screen')
            print(click)
            return
        time.sleep(0.15)
        try:
            line, useful = describe(node)
        except Exception:
            line = ''
        print(line or 'done; the element is gone now (a dialog or menu may have closed)')
    else:
        sys.exit('unknown mode ' + mode)

main()
`

/**
 * Arguments for `python3 -c ATSPI_CONTROLS` in one mode.
 * @param mode - read, find, point or act.
 * @param pid - process id of the window's app.
 * @param title - the window's title, which picks its frame.
 * @param rest - the mode's own arguments.
 * @returns the arguments after `python3`.
 */
export function atspiArgs(mode: 'read' | 'find' | 'point' | 'act', pid: number, title: string, ...rest: readonly string[]): string[] {
  return ['-c', ATSPI_CONTROLS, mode, String(pid), title, ...rest]
}

/**
 * Python that prints `PROMPT <title>` for each window the desktop portal is showing (GNOME's prompt to allow remote
 * interaction among them), or `NONE`. While GNOME shows that prompt, simulated input is held, then delivered to
 * whatever window has focus once the person answers.
 */
export const PORTAL_PROMPT = String.raw`
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
desktop = Atspi.get_desktop(0)
found = []
for i in range(desktop.get_child_count()):
    app = desktop.get_child_at_index(i)
    try:
        if app is None or not (app.get_name() or '').startswith('xdg-desktop-portal'):
            continue
        for j in range(app.get_child_count()):
            window = app.get_child_at_index(j)
            if window is not None and window.get_state_set().contains(Atspi.StateType.SHOWING):
                found.append(window.get_name() or 'a permission prompt')
    except Exception:
        continue
print('\n'.join('PROMPT ' + name for name in found) if found else 'NONE')
`
