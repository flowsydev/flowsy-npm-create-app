import json
import random
from typing import Literal, TypedDict


class User(TypedDict):
    username: str
    firstName: str
    lastName: str
    email: str
    enabled: bool
    gender: Literal["male", "female"]
    roles: list[str]


roles=["admin","editor","viewer","developer","analyst","support","manager","auditor","operator","guest"]

mexican_male=["Juan","Carlos","Pedro","Diego","Miguel","Alejandro","Luis","Jorge","Raul","Fernando"]
mexican_female=["Maria","Linda","Laura","Sofia","Ana","Carmen","Isabel","Patricia","Veronica","Martha"]

us_male=["John","Michael","David","Chris","James","Robert","Daniel","Paul","Mark","Steven"]
us_female=["Emily","Sarah","Olivia","Jessica","Amanda","Nicole","Laura","Elizabeth","Michelle","Rachel"]

users: list[User] = []
for i in range(100):
    gender='male' if i%2==0 else 'female'
    if i%4==0:
        first=random.choice(mexican_male) if gender=='male' else random.choice(mexican_female)
        last=random.choice(["Garcia","Martinez","Rodriguez","Lopez","Hernandez","Gonzalez","Perez","Sanchez","Ramirez","Torres"])
    elif i%4==1:
        first=random.choice(us_male) if gender=='male' else random.choice(us_female)
        last=random.choice(["Smith","Johnson","Brown","Jones","Miller","Davis","Garcia","Rodriguez","Martinez","Hernandez"])
    elif i%4==2:
        first=random.choice(mexican_male) if gender=='male' else random.choice(mexican_female)
        last=random.choice(["Martinez","Lopez","Gonzalez","Perez","Sanchez","Ramirez","Torres","Flores","Rivera","Gomez"])
    else:
        first=random.choice(us_male) if gender=='male' else random.choice(us_female)
        last=random.choice(["Taylor","Anderson","Thomas","Jackson","White","Harris","Martin","Thompson","Garcia","Martinez"])
    username=f"{first.lower()}.{last.lower()}".replace(" ","")
    email=f"{username}@example.com"
    role=[random.choice(roles)]
    users.append({
        "username":username,
        "firstName":first,
        "lastName":last,
        "email":email,
        "enabled":True,
        "gender":gender,
        "roles":role
    })

print(json.dumps(users, indent=2))
