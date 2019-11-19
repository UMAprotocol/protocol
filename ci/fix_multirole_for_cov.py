#!/usr/bin/env python

import sys

if len(sys.argv) != 2:
    raise Exception("Must provide file to filter")

# Read entire file into string.
read_file = open(sys.argv[1], mode='r')
file_str = read_file.read()
read_file.close()

# Replace _createSharedRole's "internal" modifier with "public".
shared_role_index = file_str.find("function _createSharedRole")
file_str = file_str[:shared_role_index] + file_str[shared_role_index:].replace("internal", "public", 1)

# Replace _createExclusiveRole's "internal" modifier with "public".
exclusive_role_index = file_str.find("function _createExclusiveRole")
file_str = file_str[:exclusive_role_index] + file_str[exclusive_role_index:].replace("internal", "public", 1)

# Overwrite the file with the contents of the string.
write_file = open(sys.argv[1], mode='w')
write_file.write(file_str)
