import socket
# socket is a networking tool
domain = input("enter domain: ")
try:
  ip_address = socket.gethostbyname(domain)
  print(ip_address)
except socket.gaierror as e:
    print("Error details:", e)
    #catch error and print details