"""Test stand-in for gi.repository.Atspi.

The accessible tree comes from the JSON file named by FAKE_ATSPI_TREE: a list of applications, each
{"pid": n, "children": [frame, ...]}, where a node is {"name", "role", "text"?, "value"?, "states": [...],
"box": [x, y, w, h]?, "actions": [...]?, "editable"?, "selectable"?, "id"?, "children": [...]}. Every operation
that changes the app is appended as one line to the file named by FAKE_ATSPI_LOG.
"""

import json
import os


def _log(line):
    with open(os.environ['FAKE_ATSPI_LOG'], 'a', encoding='utf-8') as handle:
        handle.write(line + '\n')


class _States:
    def __init__(self, names):
        self.names = set(names)

    def contains(self, state):
        return state in self.names


class _Box:
    def __init__(self, box):
        self.x, self.y, self.width, self.height = box


class Node:
    def __init__(self, data, parent=None, index=0):
        self.data = data
        self.parent = parent
        self.index = index
        self.children = [Node(child, self, i) for i, child in enumerate(data.get('children', []))]

    def get_name(self):
        return self.data.get('name', '')

    def get_role_name(self):
        return self.data.get('role', 'filler')

    def get_process_id(self):
        return self.data.get('pid', 0)

    def get_child_count(self):
        return len(self.children)

    def get_child_at_index(self, index):
        return self.children[index] if index < len(self.children) else None

    def get_parent(self):
        return self.parent

    def get_index_in_parent(self):
        return self.index

    def get_accessible_id(self):
        return self.data.get('id', '')

    def get_state_set(self):
        return _States(self.data.get('states', []))

    def get_text_iface(self):
        return self if 'text' in self.data else None

    def get_value_iface(self):
        return self if 'value' in self.data else None

    def get_component_iface(self):
        return self

    def get_action_iface(self):
        return self if self.data.get('actions') else None

    def get_selection_iface(self):
        return self if self.data.get('selectable') else None

    def get_editable_text_iface(self):
        return self if self.data.get('editable') else None


class StateType:
    SENSITIVE = 'sensitive'
    FOCUSED = 'focused'
    CHECKABLE = 'checkable'
    CHECKED = 'checked'
    EXPANDABLE = 'expandable'
    EXPANDED = 'expanded'
    SELECTED = 'selected'
    EDITABLE = 'editable'
    SHOWING = 'showing'


class CoordType:
    SCREEN = 'screen'


class Text:
    @staticmethod
    def get_character_count(node):
        return len(node.data['text'])

    @staticmethod
    def get_text(node, start, end):
        return node.data['text'][start:end]


class Value:
    @staticmethod
    def get_current_value(node):
        return node.data['value']

    @staticmethod
    def set_current_value(node, value):
        _log('set_current_value ' + node.get_name() + ' ' + str(value))
        node.data['value'] = value
        return True


class Component:
    @staticmethod
    def get_extents(node, coord):
        return _Box(node.data.get('box', [0, 0, 0, 0]))

    @staticmethod
    def grab_focus(node):
        _log('grab_focus ' + node.get_name())
        return True


class Action:
    @staticmethod
    def get_n_actions(node):
        return len(node.data['actions'])

    @staticmethod
    def get_action_name(node, index):
        return node.data['actions'][index]

    @staticmethod
    def do_action(node, index):
        _log('do_action ' + node.get_name() + ' ' + node.data['actions'][index])
        if node.data['actions'][index] == 'toggle':
            states = node.data.setdefault('states', [])
            if 'checked' in states:
                states.remove('checked')
            else:
                states.append('checked')
        return True


class Selection:
    @staticmethod
    def select_child(node, index):
        _log('select_child ' + node.get_name() + ' ' + str(index))
        return True


class EditableText:
    @staticmethod
    def set_text_contents(node, text):
        _log('set_text_contents ' + node.get_name() + ' ' + text)
        node.data['text'] = text
        return True


class _Atspi:
    StateType = StateType
    CoordType = CoordType
    Text = Text
    Value = Value
    Component = Component
    Action = Action
    Selection = Selection
    EditableText = EditableText

    @staticmethod
    def get_desktop(index):
        with open(os.environ['FAKE_ATSPI_TREE'], encoding='utf-8') as handle:
            apps = json.load(handle)
        return Node({'name': 'desktop', 'children': apps})


Atspi = _Atspi()
